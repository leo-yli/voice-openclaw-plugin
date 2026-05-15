import { createLogger } from "./logger.js";

const log = createLogger("rest-client");

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
  constructor(public type: ExchangeErrorType, public retryAfterSec?: number) {
    super(type);
    this.name = "ExchangeError";
  }
}

export interface RestClient {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
  rotate(oldToken: string, instanceId: string): Promise<{ channelToken: string }>;
  unbind(token: string, instanceId: string): Promise<void>;
}

export function createRestClient(_apiBaseUrl: string): RestClient {
  // 下一个 task 实现
  throw new Error("createRestClient not implemented yet");
}
