import { createLogger } from "./logger.js";

const log = createLogger("rest-client");

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // 3 次重试

export interface ExchangeRequest {
  code: string;
  instanceId: string;
  deviceLabel: string;
  pluginVersion: string;
}

export interface ExchangeResponse {
  channelToken: string;
  tokenPrefix: string;
  bindingId: string;
  userId: string;
  userDisplayName: string;
  wsUrl: string;
}

export type ExchangeErrorType =
  | "invalid_code_format"
  | "code_not_found"
  | "code_attempts_exceeded"
  | "code_expired"
  | "code_consumed"
  | "instance_already_bound"
  | "rate_limited"
  | "network_error"
  | "server_error"
  | "auth_failed"
  | "unknown";

export class ExchangeError extends Error {
  constructor(
    public type: ExchangeErrorType,
    public retryAfterSec?: number,
    /** HTTP 状态码，方便排查 unknown / server_error 类错误 */
    public httpStatus?: number,
    /** 响应体片段（截断到 ~200 字符），方便排查响应 schema 不匹配 */
    public responseBodySnippet?: string,
    /** 请求的 URL，方便定位是哪个 endpoint */
    public requestUrl?: string,
  ) {
    super(
      [
        type,
        httpStatus !== undefined ? `http=${httpStatus}` : "",
        requestUrl ? `url=${requestUrl}` : "",
        responseBodySnippet ? `body=${responseBodySnippet}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
    this.name = "ExchangeError";
  }
}

export interface RestClient {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
  rotate(oldToken: string, instanceId: string): Promise<{ channelToken: string }>;
  unbind(token: string, instanceId: string): Promise<void>;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function doFetch(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseProblemJson(
  res: Response,
): Promise<{ problem: { type?: string }; bodySnippet: string }> {
  try {
    const text = await res.text();
    const snippet = text.slice(0, 200);
    try {
      return { problem: JSON.parse(text), bodySnippet: snippet };
    } catch {
      return { problem: {}, bodySnippet: snippet };
    }
  } catch {
    return { problem: {}, bodySnippet: "" };
  }
}

function mapErrorType(httpStatus: number, problemType?: string): ExchangeErrorType {
  if (problemType) {
    const known: ExchangeErrorType[] = [
      "invalid_code_format",
      "code_not_found",
      "code_attempts_exceeded",
      "code_expired",
      "code_consumed",
      "instance_already_bound",
      "rate_limited",
      "auth_failed",
    ];
    if (known.includes(problemType as ExchangeErrorType)) {
      return problemType as ExchangeErrorType;
    }
  }
  if (httpStatus >= 500) return "server_error";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 401) return "auth_failed";
  return "unknown";
}

export function createRestClient(apiBaseUrl: string): RestClient {
  const base = apiBaseUrl.replace(/\/+$/, "");

  async function postWithRetry(
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    let lastRes: Response | null = null;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await doFetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
        if (res.status < 500) return res;
        lastRes = res;
        log.warn(`POST ${path} returned ${res.status}, retrying`);
      } catch (err) {
        if (attempt === RETRY_DELAYS_MS.length - 1) {
          log.error(`POST ${path} network error: ${(err as Error).message}`);
          throw new ExchangeError("network_error");
        }
        log.warn(`POST ${path} network error attempt ${attempt + 1}, retrying`);
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
    return lastRes!;
  }

  return {
    async exchange(req: ExchangeRequest): Promise<ExchangeResponse> {
      const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const res = await postWithRetry(
        "/v1/openclaw/bindings/exchange",
        {
          code: req.code,
          instance_id: req.instanceId,
          device_label: req.deviceLabel,
          plugin_version: req.pluginVersion,
        },
        {
          "x-plugin-version": req.pluginVersion,
          "x-idempotency-key": idempotencyKey,
        }
      );

      if (res.status === 200) {
        const data = (await res.json()) as Record<string, string>;
        return {
          channelToken: data.channel_token,
          tokenPrefix: data.token_prefix,
          bindingId: data.binding_id,
          userId: data.user_id,
          userDisplayName: data.user_display_name,
          wsUrl: data.ws_url,
        };
      }

      const url = `${base}/v1/openclaw/bindings/exchange`;
      const { problem, bodySnippet } = await parseProblemJson(res);
      const type = mapErrorType(res.status, problem.type);
      const retryAfter = res.headers.get("retry-after");
      log.error(
        `exchange failed: http=${res.status} type=${type} url=${url} body=${bodySnippet}`,
      );
      throw new ExchangeError(
        type,
        retryAfter ? parseInt(retryAfter, 10) : undefined,
        res.status,
        bodySnippet,
        url,
      );
    },

    async rotate(oldToken: string, instanceId: string): Promise<{ channelToken: string }> {
      const url = `${base}/v1/openclaw/bindings/rotate`;
      const res = await postWithRetry(
        "/v1/openclaw/bindings/rotate",
        {},
        {
          authorization: `Bearer ${oldToken}`,
          "x-instance-id": instanceId,
        }
      );
      if (res.status === 200) {
        const data = (await res.json()) as Record<string, string>;
        return { channelToken: data.channel_token };
      }
      const { problem, bodySnippet } = await parseProblemJson(res);
      throw new ExchangeError(
        mapErrorType(res.status, problem.type),
        undefined,
        res.status,
        bodySnippet,
        url,
      );
    },

    async unbind(token: string, instanceId: string): Promise<void> {
      const url = `${base}/v1/openclaw/bindings/me`;
      const res = await doFetch(url, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          "x-instance-id": instanceId,
        },
      });
      if (res.status === 204) return;
      if (res.status >= 500) {
        throw new ExchangeError("server_error", undefined, res.status, undefined, url);
      }
      const { problem, bodySnippet } = await parseProblemJson(res);
      throw new ExchangeError(
        mapErrorType(res.status, problem.type),
        undefined,
        res.status,
        bodySnippet,
        url,
      );
    },
  };
}
