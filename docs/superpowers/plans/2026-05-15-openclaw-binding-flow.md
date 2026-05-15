# OpenClaw Binding Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@xalgo/voice-openclaw-plugin` 实施基于绑定码 + 长期 Token + instance_id 双因子的绑定流程，覆盖 spec 中 P1-P3 阶段（基础绑定、控制事件、鉴权增强）。

**Architecture:** 新增 3 个核心模块（binding-store / rest-client / control-events），改写 setup-entry，扩展 config / protocol / client，通过 HTTPS REST 完成绑定/解绑/rotate，通过 WebSocket 新增 control_event 推送绑定生命周期变化。

**Tech Stack:** TypeScript + Node.js + ws@8 + vitest@2 + Node 内置 `node:crypto` (UUID v4) + Node 18+ 内置 `fetch`（无需 axios）。

**Spec 参考:** `docs/superpowers/specs/2026-05-15-openclaw-binding-flow-design.md`

---

## 文件结构

### 新增文件

| 路径 | 责任 |
|---|---|
| `src/binding-store.ts` | 本地绑定持久化抽象层（read/write/updateToken/clear/isBound） |
| `src/rest-client.ts` | REST API 客户端（exchange/rotate/unbind），typed ExchangeError |
| `src/control-events.ts` | 4 种 control_event 的处理（binding_revoked/token_rotated_notify/metadata/announcement） |
| `test/unit/binding-store.test.ts` | binding-store 单元测试 |
| `test/unit/rest-client.test.ts` | rest-client 单元测试（用 vitest fetch mock） |
| `test/unit/control-events.test.ts` | control-events 单元测试 |
| `test/unit/setup-entry.test.ts` | setup-entry 流程单元测试 |
| `test/integration/binding-flow.test.ts` | 端到端集成测试（mock-server 扩展） |

### 修改文件

| 路径 | 改动 |
|---|---|
| `src/config.ts` | 新增 `apiBaseUrl/instanceId/deviceLabel/boundAt/boundUserId/boundUserName` 字段 |
| `src/protocol.ts` | 新增 4 个 control_event 类型字面量 + payload 接口 |
| `src/client.ts` | `instanceId` 从 binding-store 注入；新增 control_event dispatch 分支；新增 auth_failed reason 细分 |
| `src/channel.ts` | 注入 binding-store；onBindingLost 转发到 platform status |
| `src/types/openclaw.d.ts` | 扩展 `SetupContext` 类型（含 readConfig） |
| `setup-entry.ts` | 完整重写为"绑定码→exchange→写盘"流程 |
| `test/integration/mock-server.ts` | 新增 control_event 推送 + REST mock 能力 |

### 不修改文件

`src/inbound.ts` / `src/outbound.ts` / `src/streaming.ts` / `src/confirmation.ts` / `src/interrupt.ts` / `src/delivery-ack.ts` / `src/session.ts` / `src/reconnect.ts` / `src/logger.ts`：与绑定流程无关，零改动。

---

## 阶段划分

- **P1（Task 1-7）：基础绑定** — config 扩展、binding-store、rest-client、setup-entry 重写、client 注入
- **P2（Task 8-11）：控制事件** — protocol 扩展、control-events、client dispatch、mock-server 扩展
- **P3（Task 12-14）：鉴权增强 + 端到端验证** — connect 双因子、auth_failed 细分、集成测试

---

# P1 基础绑定

## Task 1：扩展 `src/config.ts` 配置字段

**Files:**
- Modify: `src/config.ts`（添加 6 个字段 + 默认值）

- [ ] **Step 1: 写失败的单元测试**

把现有 `src/config.ts` 的 `resolveConfig` 单元测试补充（如果没有就新建 `test/unit/config.test.ts`）：

```typescript
// test/unit/config.test.ts
import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULT_CONFIG } from "../../src/config.js";

describe("resolveConfig", () => {
  it("includes new binding fields with defaults", () => {
    const cfg = resolveConfig({ token: "t" });
    expect(cfg.apiBaseUrl).toBe("https://channel.xalgo.ai");
    expect(cfg.instanceId).toBe("");
    expect(cfg.boundAt).toBe("");
    expect(cfg.boundUserId).toBe("");
  });

  it("preserves user-provided binding fields", () => {
    const cfg = resolveConfig({
      token: "t",
      instanceId: "oc_uuid",
      boundUserId: "user_1",
      apiBaseUrl: "https://custom.example.com",
    });
    expect(cfg.instanceId).toBe("oc_uuid");
    expect(cfg.boundUserId).toBe("user_1");
    expect(cfg.apiBaseUrl).toBe("https://custom.example.com");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL with "expected undefined to be ..."

- [ ] **Step 3: 修改 `src/config.ts`**

完整替换为：

```typescript
export interface RiskPolicy {
  confirmExternalSend: boolean;
  confirmDangerousTools: boolean;
  allowPureVoiceR3: boolean;
}

export interface ReconnectConfig {
  minDelayMs: number;
  maxDelayMs: number;
  resume: boolean;
}

export interface XalgoVoiceConfig {
  enabled: boolean;
  serverUrl: string;
  token: string;
  agentId: string;
  sessionPrefix: string;
  streaming: boolean;
  replyMode: "voice_first" | "text_first" | "both";
  riskPolicy: RiskPolicy;
  reconnect: ReconnectConfig;

  // 绑定相关字段（spec §4.3）
  apiBaseUrl: string;
  instanceId: string;
  deviceLabel: string;
  boundAt: string;
  boundUserId: string;
  boundUserName: string;
}

export const DEFAULT_CONFIG: Omit<XalgoVoiceConfig, "token"> = {
  enabled: false,
  serverUrl: "wss://channel.xalgo.ai/openclaw/connect",
  agentId: "voice",
  sessionPrefix: "xalgo_voice",
  streaming: true,
  replyMode: "voice_first",
  riskPolicy: {
    confirmExternalSend: true,
    confirmDangerousTools: true,
    allowPureVoiceR3: false,
  },
  reconnect: {
    minDelayMs: 1000,
    maxDelayMs: 30000,
    resume: true,
  },
  apiBaseUrl: "https://channel.xalgo.ai",
  instanceId: "",
  deviceLabel: "",
  boundAt: "",
  boundUserId: "",
  boundUserName: "",
};

export function resolveConfig(raw: Partial<XalgoVoiceConfig> & { token: string }): XalgoVoiceConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...raw.riskPolicy },
    reconnect: { ...DEFAULT_CONFIG.reconnect, ...raw.reconnect },
  };
}
```

- [ ] **Step 4: 运行所有相关测试验证通过**

Run: `npx vitest run test/unit/config.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: 无错误（确认 `XalgoVoiceConfig` 新字段未被现有代码引用到错误的位置）

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/config.ts test/unit/config.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(config): add binding-related fields to XalgoVoiceConfig"
```

---

## Task 2：扩展 `src/types/openclaw.d.ts` 的 SetupContext

**Files:**
- Modify: `src/types/openclaw.d.ts`（提取 SetupContext 类型）

- [ ] **Step 1: 修改 `src/types/openclaw.d.ts`**

完整替换为：

```typescript
declare module "openclaw" {
  export interface OpenClawApi {
    registerChannel(opts: { plugin: ChannelPlugin }): void;
  }

  export interface ChannelPlugin {
    id: string;
    meta: {
      id: string;
      label: string;
      selectionLabel?: string;
      docsPath?: string;
      blurb?: string;
    };
    capabilities: Record<string, unknown>;
    config: {
      listAccountIds: (cfg: any) => string[];
      resolveAccount: (cfg: any, accountId?: string) => any;
    };
    outbound: any;
    inbound: any;
  }

  /** OpenClaw setup wizard 上下文（spec §13） */
  export interface SetupContext {
    prompt: (question: string) => Promise<string>;
    writeConfig: (key: string, value: unknown) => Promise<void>;
    log: (msg: string) => void;
    /** 可选：读现有配置。OpenClaw 框架是否提供为 spec §14 开放问题 */
    readConfig?: (key: string) => Promise<unknown>;
  }
}
```

- [ ] **Step 2: 验证类型编译通过**

Run: `npm run lint`
Expected: PASS（无错误）

- [ ] **Step 3: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/types/openclaw.d.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(types): extract SetupContext with optional readConfig"
```

---

## Task 3：创建 `src/binding-store.ts`

**Files:**
- Create: `src/binding-store.ts`
- Test: `test/unit/binding-store.test.ts`

- [ ] **Step 1: 写失败的单元测试**

创建 `test/unit/binding-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createBindingStore, type BindingState } from "../../src/binding-store.js";

function makeMemoryAdapter() {
  const data: Record<string, unknown> = {};
  return {
    storage: data,
    read: async (key: string) => data[key],
    write: async (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

describe("BindingStore", () => {
  let adapter: ReturnType<typeof makeMemoryAdapter>;

  beforeEach(() => {
    adapter = makeMemoryAdapter();
  });

  it("read returns null when no binding exists", async () => {
    const store = createBindingStore(adapter);
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("write then read returns the full state", async () => {
    const store = createBindingStore(adapter);
    const state: BindingState = {
      token: "xvc_live_abc",
      instanceId: "oc_uuid1",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "user_1",
      boundUserName: "杨立",
      deviceLabel: "OpenClaw on host",
    };
    await store.write(state);
    expect(await store.read()).toEqual(state);
    expect(await store.isBound()).toBe(true);
  });

  it("updateToken only changes the token field", async () => {
    const store = createBindingStore(adapter);
    await store.write({
      token: "old",
      instanceId: "oc_uuid1",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "user_1",
    });
    await store.updateToken("new");
    const after = await store.read();
    expect(after?.token).toBe("new");
    expect(after?.instanceId).toBe("oc_uuid1");
    expect(after?.boundUserId).toBe("user_1");
  });

  it("clear removes all binding fields", async () => {
    const store = createBindingStore(adapter);
    await store.write({
      token: "t",
      instanceId: "i",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "u",
    });
    await store.clear();
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("partial data (missing required fields) is treated as unbound", async () => {
    adapter.storage["channels.xalgoVoice.token"] = "t";
    // 缺 instanceId
    const store = createBindingStore(adapter);
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("updateToken throws when not yet bound", async () => {
    const store = createBindingStore(adapter);
    await expect(store.updateToken("new")).rejects.toThrow(/no binding/i);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/binding-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `src/binding-store.ts`**

```typescript
import { createLogger } from "./logger.js";

const log = createLogger("binding-store");

export interface BindingState {
  token: string;
  instanceId: string;
  boundAt: string;
  boundUserId: string;
  boundUserName?: string;
  deviceLabel?: string;
}

export interface BindingStore {
  read(): Promise<BindingState | null>;
  write(state: BindingState): Promise<void>;
  updateToken(newToken: string): Promise<void>;
  clear(): Promise<void>;
  isBound(): Promise<boolean>;
}

export interface StoreAdapter {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
}

const KEYS = {
  token: "channels.xalgoVoice.token",
  instanceId: "channels.xalgoVoice.instanceId",
  boundAt: "channels.xalgoVoice.boundAt",
  boundUserId: "channels.xalgoVoice.boundUserId",
  boundUserName: "channels.xalgoVoice.boundUserName",
  deviceLabel: "channels.xalgoVoice.deviceLabel",
} as const;

export function createBindingStore(adapter: StoreAdapter): BindingStore {
  const readField = async (key: string): Promise<string> => {
    const v = await adapter.read(key);
    return typeof v === "string" ? v : "";
  };

  return {
    async read(): Promise<BindingState | null> {
      const token = await readField(KEYS.token);
      const instanceId = await readField(KEYS.instanceId);
      const boundAt = await readField(KEYS.boundAt);
      const boundUserId = await readField(KEYS.boundUserId);

      // 任意一个必需字段缺失 = 未绑定
      if (!token || !instanceId || !boundAt || !boundUserId) {
        return null;
      }

      const boundUserName = await readField(KEYS.boundUserName);
      const deviceLabel = await readField(KEYS.deviceLabel);
      return {
        token,
        instanceId,
        boundAt,
        boundUserId,
        ...(boundUserName ? { boundUserName } : {}),
        ...(deviceLabel ? { deviceLabel } : {}),
      };
    },

    async write(state: BindingState): Promise<void> {
      await adapter.write(KEYS.token, state.token);
      await adapter.write(KEYS.instanceId, state.instanceId);
      await adapter.write(KEYS.boundAt, state.boundAt);
      await adapter.write(KEYS.boundUserId, state.boundUserId);
      await adapter.write(KEYS.boundUserName, state.boundUserName ?? "");
      await adapter.write(KEYS.deviceLabel, state.deviceLabel ?? "");
      log.info(`Binding written for user=${state.boundUserId} instance=${state.instanceId.slice(0, 16)}...`);
    },

    async updateToken(newToken: string): Promise<void> {
      const current = await this.read();
      if (!current) throw new Error("No binding exists, cannot updateToken");
      await adapter.write(KEYS.token, newToken);
      log.info(`Token rotated for instance=${current.instanceId.slice(0, 16)}...`);
    },

    async clear(): Promise<void> {
      await adapter.write(KEYS.token, "");
      await adapter.write(KEYS.instanceId, "");
      await adapter.write(KEYS.boundAt, "");
      await adapter.write(KEYS.boundUserId, "");
      await adapter.write(KEYS.boundUserName, "");
      await adapter.write(KEYS.deviceLabel, "");
      log.info("Binding cleared");
    },

    async isBound(): Promise<boolean> {
      return (await this.read()) !== null;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/binding-store.test.ts`
Expected: PASS（6 test 全过）

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/binding-store.ts test/unit/binding-store.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(binding): add BindingStore for local binding persistence"
```

---

## Task 4：创建 `src/rest-client.ts` —— ExchangeError 与类型定义

**Files:**
- Create: `src/rest-client.ts`（仅类型与 ExchangeError，下个 task 加实现）
- Test: `test/unit/rest-client.test.ts`

- [ ] **Step 1: 写失败的测试（仅类型层面）**

创建 `test/unit/rest-client.test.ts`，先验证错误类的结构：

```typescript
import { describe, it, expect } from "vitest";
import { ExchangeError } from "../../src/rest-client.js";

describe("ExchangeError", () => {
  it("carries type and optional retryAfterSec", () => {
    const e = new ExchangeError("code_expired");
    expect(e.type).toBe("code_expired");
    expect(e.retryAfterSec).toBeUndefined();
    expect(e instanceof Error).toBe(true);
    expect(e.message).toBe("code_expired");
  });

  it("carries retryAfterSec for rate_limited", () => {
    const e = new ExchangeError("rate_limited", 60);
    expect(e.type).toBe("rate_limited");
    expect(e.retryAfterSec).toBe(60);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/rest-client.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `src/rest-client.ts` 类型骨架**

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/rest-client.test.ts`
Expected: PASS（2 test 过）

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/rest-client.ts test/unit/rest-client.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(rest): add RestClient interface and ExchangeError type"
```

---

## Task 5：实现 `RestClient.exchange()`

**Files:**
- Modify: `src/rest-client.ts`（实现 exchange 方法）
- Modify: `test/unit/rest-client.test.ts`（追加 exchange 测试）

- [ ] **Step 1: 追加失败的测试**

在 `test/unit/rest-client.test.ts` 末尾追加：

```typescript
import { createRestClient } from "../../src/rest-client.js";
import { beforeEach, vi, afterEach } from "vitest";

describe("RestClient.exchange", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed response on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          channel_token: "xvc_live_abc",
          token_prefix: "xvc_live_a",
          binding_id: "b_1",
          user_id: "u_1",
          user_display_name: "杨立",
          ws_url: "wss://x/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const client = createRestClient("https://api.example.com");
    const resp = await client.exchange({
      code: "A3FK9PQX",
      instanceId: "oc_uuid",
      deviceLabel: "host",
      pluginVersion: "0.1.0",
    });

    expect(resp.channelToken).toBe("xvc_live_abc");
    expect(resp.userId).toBe("u_1");
    expect(resp.userDisplayName).toBe("杨立");
    expect(resp.wsUrl).toBe("wss://x/ws");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/exchange");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.code).toBe("A3FK9PQX");
    expect(body.instance_id).toBe("oc_uuid");
  });

  it("throws ExchangeError(code_expired) on 410 + error.type=code_expired", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "code_expired", title: "Code expired" }),
        { status: 410, headers: { "content-type": "application/problem+json" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "0.1.0" })
    ).rejects.toMatchObject({ type: "code_expired" });
  });

  it("throws ExchangeError(rate_limited) with retryAfterSec from header on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "rate_limited", title: "Too many" }),
        { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "30" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    const err = await client
      .exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "0.1.0" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExchangeError);
    expect(err.type).toBe("rate_limited");
    expect(err.retryAfterSec).toBe(30);
  });

  it("retries on 500 up to 3 times then throws server_error", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "0.1.0" })
    ).rejects.toMatchObject({ type: "server_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20000);

  it("throws network_error on fetch rejection", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "0.1.0" })
    ).rejects.toMatchObject({ type: "network_error" });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/rest-client.test.ts`
Expected: FAIL（createRestClient 抛 "not implemented"）

- [ ] **Step 3: 实现 `src/rest-client.ts`**

完整替换为：

```typescript
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

async function parseProblemJson(res: Response): Promise<{ type?: string }> {
  try {
    return await res.json();
  } catch {
    return {};
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

      const problem = await parseProblemJson(res);
      const type = mapErrorType(res.status, problem.type);
      const retryAfter = res.headers.get("retry-after");
      throw new ExchangeError(
        type,
        retryAfter ? parseInt(retryAfter, 10) : undefined
      );
    },

    async rotate(oldToken: string, instanceId: string): Promise<{ channelToken: string }> {
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
      const problem = await parseProblemJson(res);
      throw new ExchangeError(mapErrorType(res.status, problem.type));
    },

    async unbind(token: string, instanceId: string): Promise<void> {
      const res = await doFetch(`${base}/v1/openclaw/bindings/me`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          "x-instance-id": instanceId,
        },
      });
      if (res.status === 204) return;
      if (res.status >= 500) {
        // unbind 不重试，留给上层决定
        throw new ExchangeError("server_error");
      }
      const problem = await parseProblemJson(res);
      throw new ExchangeError(mapErrorType(res.status, problem.type));
    },
  };
}
```

- [ ] **Step 4: 运行所有 rest-client 测试**

Run: `npx vitest run test/unit/rest-client.test.ts`
Expected: PASS（7 个 test 全过，含 retry 测试约 7s）

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/rest-client.ts test/unit/rest-client.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(rest): implement exchange/rotate/unbind with retry"
```

---

## Task 6：补全 `RestClient.rotate()` 和 `unbind()` 测试

**Files:**
- Modify: `test/unit/rest-client.test.ts`（追加 rotate / unbind 测试）

- [ ] **Step 1: 追加 rotate / unbind 测试**

在 `test/unit/rest-client.test.ts` 末尾追加：

```typescript
describe("RestClient.rotate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns new token on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ channel_token: "xvc_live_new", token_prefix: "xvc_live_n", rotated_at: "2026-05-15T00:00:00Z" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    const result = await client.rotate("old", "oc_uuid");
    expect(result.channelToken).toBe("xvc_live_new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/rotate");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer old");
    expect((init.headers as Record<string, string>)["x-instance-id"]).toBe("oc_uuid");
  });

  it("throws auth_failed on 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "auth_failed" }), { status: 401 })
    );
    const client = createRestClient("https://api.example.com");
    await expect(client.rotate("bad", "oc_uuid")).rejects.toMatchObject({ type: "auth_failed" });
  });
});

describe("RestClient.unbind", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves silently on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createRestClient("https://api.example.com");
    await expect(client.unbind("t", "oc_uuid")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/me");
    expect(init.method).toBe("DELETE");
  });

  it("throws on 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "auth_failed" }), { status: 401 })
    );
    const client = createRestClient("https://api.example.com");
    await expect(client.unbind("bad", "oc_uuid")).rejects.toMatchObject({ type: "auth_failed" });
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run test/unit/rest-client.test.ts`
Expected: PASS（11 个测试）

- [ ] **Step 3: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add test/unit/rest-client.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "test(rest): cover rotate and unbind"
```

---

## Task 7：重写 `setup-entry.ts`

**Files:**
- Modify: `setup-entry.ts`（完整重写）
- Test: `test/unit/setup-entry.test.ts`

- [ ] **Step 1: 写失败的单元测试**

创建 `test/unit/setup-entry.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import setup from "../../setup-entry.js";

function makeContext(prompts: string[]) {
  const storage: Record<string, unknown> = {};
  const logs: string[] = [];
  let promptIdx = 0;

  return {
    storage,
    logs,
    context: {
      prompt: async (_q: string) => prompts[promptIdx++] ?? "",
      writeConfig: async (k: string, v: unknown) => {
        storage[k] = v;
      },
      readConfig: async (k: string) => storage[k],
      log: (m: string) => logs.push(m),
    },
  };
}

describe("setup-entry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: prompt code → exchange → confirm → write config", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          channel_token: "xvc_live_xyz",
          token_prefix: "xvc_live_x",
          binding_id: "b_1",
          user_id: "u_1",
          user_display_name: "杨立",
          ws_url: "wss://example.com/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { storage, logs, context } = makeContext([
      "A3FK9PQX",            // 绑定码
      "",                     // apiBaseUrl 用默认
      "y",                    // 确认绑定
    ]);

    await setup(context);

    expect(storage["channels.xalgoVoice.token"]).toBe("xvc_live_xyz");
    expect(storage["channels.xalgoVoice.boundUserId"]).toBe("u_1");
    expect(typeof storage["channels.xalgoVoice.instanceId"]).toBe("string");
    expect((storage["channels.xalgoVoice.instanceId"] as string).startsWith("oc_")).toBe(true);
    expect(logs.some((l) => l.includes("绑定成功") || l.includes("已保存"))).toBe(true);
  });

  it("user declines confirmation → calls unbind to rollback", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            channel_token: "xvc_live_xyz",
            token_prefix: "xvc_live_x",
            binding_id: "b_1",
            user_id: "u_1",
            user_display_name: "Other",
            ws_url: "wss://example.com/ws",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { storage, context } = makeContext(["A3FK9PQX", "", "n"]);

    await setup(context);

    expect(storage["channels.xalgoVoice.token"]).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("expired code → log error and abort without writing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "code_expired" }), {
        status: 410,
        headers: { "content-type": "application/problem+json" },
      })
    );

    const { storage, logs, context } = makeContext(["A3FK9PQX", ""]);

    await setup(context);

    expect(storage["channels.xalgoVoice.token"]).toBeFalsy();
    expect(logs.some((l) => l.includes("已过期"))).toBe(true);
  });

  it("empty code input → abort silently", async () => {
    const { storage, context } = makeContext([""]);
    await setup(context);
    expect(storage["channels.xalgoVoice.token"]).toBeFalsy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalid code format (length != 8) → log error and abort", async () => {
    const { storage, logs, context } = makeContext(["SHORT"]);
    await setup(context);
    expect(storage["channels.xalgoVoice.token"]).toBeFalsy();
    expect(logs.some((l) => l.includes("格式"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("existing binding + action=1 (keep) → no changes", async () => {
    const { storage, context } = makeContext(["1"]);
    storage["channels.xalgoVoice.token"] = "old_token";
    storage["channels.xalgoVoice.instanceId"] = "oc_existing";
    storage["channels.xalgoVoice.boundAt"] = "2026-05-14T00:00:00Z";
    storage["channels.xalgoVoice.boundUserId"] = "u_old";

    await setup(context);

    expect(storage["channels.xalgoVoice.token"]).toBe("old_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/setup-entry.test.ts`
Expected: FAIL（旧 setup-entry 还是 token 输入流程）

- [ ] **Step 3: 完整替换 `setup-entry.ts`**

```typescript
import crypto from "node:crypto";
import os from "node:os";
import { createBindingStore, type StoreAdapter } from "./src/binding-store.js";
import { createRestClient, ExchangeError, type ExchangeErrorType } from "./src/rest-client.js";
import { createLogger } from "./src/logger.js";

const log = createLogger("setup");

const PLUGIN_VERSION = "0.1.0";
const DEFAULT_API_BASE_URL = "https://channel.xalgo.ai";
const CODE_REGEX = /^[A-HJKMNPQRTV-Y3-9]{8}$/i;
// Base32 字符集 - 0/O/1/I/L/S/2/Z，再去掉 U/W 防混淆

const ERROR_MESSAGES: Record<ExchangeErrorType, string> = {
  invalid_code_format: "绑定码格式不对（8 位字母数字）",
  code_not_found: "绑定码无效，请检查输入或在 App 重新生成",
  code_attempts_exceeded: "尝试次数过多，请在 App 重新生成绑定码",
  code_expired: "绑定码已过期（5 分钟），请在 App 重新生成",
  code_consumed: "该绑定码已被使用过",
  instance_already_bound: "该 OpenClaw 实例已绑定到此账号",
  rate_limited: "请求过快，请稍后重试",
  network_error: "网络错误，请检查网络后重试",
  server_error: "服务暂时不可用",
  auth_failed: "鉴权失败",
  unknown: "未知错误",
};

export interface SetupContext {
  prompt: (question: string) => Promise<string>;
  writeConfig: (key: string, value: unknown) => Promise<void>;
  readConfig?: (key: string) => Promise<unknown>;
  log: (msg: string) => void;
}

function makeAdapter(ctx: SetupContext): StoreAdapter {
  return {
    read: ctx.readConfig
      ? (k) => ctx.readConfig!(k)
      : async () => undefined,
    write: ctx.writeConfig,
  };
}

async function handleUnbind(
  ctx: SetupContext,
  store: ReturnType<typeof createBindingStore>,
  apiBaseUrl: string
): Promise<void> {
  const existing = await store.read();
  if (!existing) {
    ctx.log("当前没有绑定，无需解绑。");
    return;
  }
  const client = createRestClient(apiBaseUrl);
  ctx.log("正在解绑...");
  try {
    await client.unbind(existing.token, existing.instanceId);
    await store.clear();
    ctx.log("✓ 已解绑。");
  } catch (err) {
    if (err instanceof ExchangeError) {
      ctx.log(`⚠ 服务端解绑失败 (${err.type})，但本地配置已清空。`);
    } else {
      ctx.log(`⚠ 解绑出错: ${(err as Error).message}`);
    }
    await store.clear();
  }
}

export default async function setup(context: SetupContext): Promise<void> {
  context.log("Xalgo Voice Channel 配置向导");
  context.log("────────────────────────────");
  context.log("");

  const store = createBindingStore(makeAdapter(context));
  const existing = await store.read();

  let apiBaseUrl = DEFAULT_API_BASE_URL;

  // 已绑定 → 询问操作
  if (existing) {
    context.log(`当前已绑定到: ${existing.boundUserName ?? "(未知)"} (${existing.boundUserId})`);
    context.log(`Instance ID: ${existing.instanceId.slice(0, 16)}...`);
    context.log(`绑定时间: ${existing.boundAt}`);
    context.log("");
    const action = await context.prompt("选择操作: [1] 保持现状  [2] 重新绑定  [3] 解绑");
    if (action.trim() === "1" || action.trim() === "") {
      context.log("保持现状。");
      return;
    }
    if (action.trim() === "3") {
      return await handleUnbind(context, store, apiBaseUrl);
    }
    // action === "2" → 走重新绑定
  }

  // 1. 读取/生成 instance_id
  let instanceId = existing?.instanceId;
  if (!instanceId) {
    instanceId = `oc_${crypto.randomUUID()}`;
    context.log(`生成新设备 ID: ${instanceId.slice(0, 16)}...`);
  }

  // 2. prompt 绑定码
  context.log("");
  context.log("请在 Xalgo App 中点击「连接 OpenClaw」获取 8 位绑定码。");
  const code = (await context.prompt("请输入绑定码:")).trim().toUpperCase();
  if (!code) {
    context.log("已取消。");
    return;
  }
  if (!CODE_REGEX.test(code)) {
    context.log(`✗ ${ERROR_MESSAGES.invalid_code_format}`);
    return;
  }

  // 3. prompt API base URL
  const apiInput = await context.prompt(
    `API Server 地址 (默认: ${DEFAULT_API_BASE_URL}):`
  );
  apiBaseUrl = apiInput.trim() || DEFAULT_API_BASE_URL;

  // 4. 调 exchange
  const client = createRestClient(apiBaseUrl);
  context.log("正在验证绑定码...");

  let resp;
  try {
    resp = await client.exchange({
      code,
      instanceId,
      deviceLabel: `OpenClaw on ${os.hostname()}`,
      pluginVersion: PLUGIN_VERSION,
    });
  } catch (err) {
    if (err instanceof ExchangeError) {
      context.log(`✗ ${ERROR_MESSAGES[err.type] ?? ERROR_MESSAGES.unknown}`);
      if (err.retryAfterSec) {
        context.log(`  请 ${err.retryAfterSec} 秒后重试`);
      }
    } else {
      context.log(`✗ 错误: ${(err as Error).message}`);
    }
    return;
  }

  // 5. 用户身份二次确认
  context.log("");
  context.log(`即将绑定到: ${resp.userDisplayName} (${resp.userId})`);
  const confirm = (await context.prompt("确认绑定吗？[y/N]:")).trim().toLowerCase();
  if (confirm !== "y" && confirm !== "yes") {
    context.log("已取消绑定，正在回滚服务端记录...");
    try {
      await client.unbind(resp.channelToken, instanceId);
    } catch (err) {
      context.log(`⚠ 回滚失败: ${(err as Error).message}`);
    }
    return;
  }

  // 6. 写盘
  await store.write({
    token: resp.channelToken,
    instanceId,
    boundAt: new Date().toISOString(),
    boundUserId: resp.userId,
    boundUserName: resp.userDisplayName,
    deviceLabel: `OpenClaw on ${os.hostname()}`,
  });
  await context.writeConfig("channels.xalgoVoice.enabled", true);
  await context.writeConfig("channels.xalgoVoice.apiBaseUrl", apiBaseUrl);
  await context.writeConfig("channels.xalgoVoice.serverUrl", resp.wsUrl);

  context.log("✓ 绑定成功，配置已保存。");
  context.log("  插件启动后会自动建立 WebSocket 连接。");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/setup-entry.test.ts`
Expected: PASS（6 test 全过）

- [ ] **Step 5: 运行完整测试套件确认无回归**

Run: `npm test`
Expected: PASS（所有测试通过）

Run: `npm run lint`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add setup-entry.ts test/unit/setup-entry.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(setup): rewrite setup-entry with binding code exchange flow"
```

---

## Task 8：让 `XvcClient` 从 binding-store 注入 instanceId

**Files:**
- Modify: `src/client.ts`（构造器接收 binding-store，instanceId 从 binding 读）
- Modify: `src/channel.ts`（创建 XvcClient 时注入 binding-store）

- [ ] **Step 1: 写失败的测试**

创建 `test/unit/client-instance-id.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import type { BindingStore } from "../../src/binding-store.js";

function makeBindingStoreStub(instanceId: string): BindingStore {
  return {
    read: async () => ({
      token: "xvc_live_t",
      instanceId,
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "u_1",
    }),
    write: async () => {},
    updateToken: async () => {},
    clear: async () => {},
    isBound: async () => true,
  };
}

describe("XvcClient.instanceId injection", () => {
  it("uses instance_id from binding store, not random fallback", async () => {
    const cfg = resolveConfig({ token: "t" });
    const store = makeBindingStoreStub("oc_550e8400-e29b-41d4-a716-446655440000");
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      store
    );

    // 通过暴露 readonly accessor 验证
    const id = await client.getInstanceId();
    expect(id).toBe("oc_550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null when binding store has no binding", async () => {
    const cfg = resolveConfig({ token: "" });
    const store: BindingStore = {
      read: async () => null,
      write: async () => {},
      updateToken: async () => {},
      clear: async () => {},
      isBound: async () => false,
    };
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      store
    );
    expect(await client.getInstanceId()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/client-instance-id.test.ts`
Expected: FAIL（XvcClient 构造器签名不匹配）

- [ ] **Step 3: 修改 `src/client.ts`**

修改构造器并新增 `getInstanceId()`，找到这段：

```typescript
constructor(config: XalgoVoiceConfig, events: ClientEvents) {
    this.config = config;
    this.events = events;
    this.reconnect = new ReconnectManager(config.reconnect);
    this.instanceId = `oc_${Date.now().toString(36)}`;
  }
```

替换为：

```typescript
constructor(
  config: XalgoVoiceConfig,
  events: ClientEvents,
  private bindingStore: BindingStore
) {
  this.config = config;
  this.events = events;
  this.reconnect = new ReconnectManager(config.reconnect);
  this.instanceId = null;
}

async getInstanceId(): Promise<string | null> {
  if (this.instanceId) return this.instanceId;
  const binding = await this.bindingStore.read();
  if (binding) {
    this.instanceId = binding.instanceId;
    return this.instanceId;
  }
  return null;
}
```

同时把字段类型从 `private instanceId: string` 改为 `private instanceId: string | null`。

并在 `src/client.ts` 顶部新增 import：

```typescript
import type { BindingStore } from "./binding-store.js";
```

最后修改 `sendConnect` 方法，让它从 binding-store 拿 token + instance_id：

```typescript
private async sendConnect(): Promise<void> {
  const binding = await this.bindingStore.read();
  if (!binding) {
    log.error("No binding available, cannot connect");
    this.setStatus("auth_failed");
    return;
  }
  this.instanceId = binding.instanceId;

  const payload: ConnectPayload = {
    protocol_version: 1,
    client: {
      kind: "openclaw",
      plugin: "@xalgo/voice-openclaw-plugin",
      plugin_version: "0.1.0",
      instance_id: binding.instanceId,
      device_name: binding.deviceLabel ?? "OpenClaw Instance",
    },
    channel: "xalgo_voice",
    auth: { token: binding.token },
    capabilities: [
      "text_message",
      "streaming_reply",
      "confirmation",
      "background_notification",
      "voice_interrupt",
      "delivery_ack",
    ],
  };
  this.send(createEvent("connect", payload));
}
```

注意 `handleOpen` 现在需要 `await`：

```typescript
private handleOpen(): void {
  log.info("WebSocket connected");
  if (this.reconnect.shouldResume) {
    this.sendResume();
  } else {
    this.sendConnect().catch((err) => log.error("sendConnect failed", err));
  }
}
```

同时把 `sendResume` 的 token 改为从 binding-store 拿（异步）：

```typescript
private async sendResume(): Promise<void> {
  const binding = await this.bindingStore.read();
  if (!binding) {
    this.setStatus("auth_failed");
    return;
  }
  const payload: ResumePayload = {
    connection_id: this.reconnect.connectionId!,
    last_event_id: this.reconnect.lastEventId!,
    auth: { token: binding.token },
  };
  this.send(createEvent("resume", payload));
}
```

`handleOpen` 调用 `sendResume()` 也要改为带 catch：

```typescript
this.sendResume().catch((err) => log.error("sendResume failed", err));
```

- [ ] **Step 4: 修改 `src/channel.ts` 注入 binding-store**

找到这段：

```typescript
constructor(rawConfig: Partial<XalgoVoiceConfig> & { token: string }) {
    this.config = resolveConfig(rawConfig);
    ...
    this.client = new XvcClient(this.config, {
      onEvent: (event) => this.dispatchEvent(event),
      onStatusChange: (status) => this.handleStatusChange(status),
    });
```

改为接受 binding-store 注入：

```typescript
constructor(
  rawConfig: Partial<XalgoVoiceConfig> & { token: string },
  bindingStore: BindingStore
) {
  this.config = resolveConfig(rawConfig);
  this.streaming = new StreamingManager();
  this.confirmation = new ConfirmationManager();
  this.interrupt = new InterruptHandler();
  this.delivery = new DeliveryTracker();

  this.client = new XvcClient(
    this.config,
    {
      onEvent: (event) => this.dispatchEvent(event),
      onStatusChange: (status) => this.handleStatusChange(status),
    },
    bindingStore
  );
  // ...其余不变
}
```

在 `src/channel.ts` 顶部新增 import：

```typescript
import type { BindingStore } from "./binding-store.js";
```

并修改文件底部 `createInboundAdapter`，让 OpenClaw 平台调进来时也能构造 binding-store：

```typescript
import { createBindingStore, type StoreAdapter } from "./binding-store.js";

export function createInboundAdapter() {
  let channel: XalgoVoiceChannel | null = null;

  return {
    async start({ config, handleMessage, handleStatus, readConfig, writeConfig }: {
      config: any;
      account?: any;
      handleMessage: (msg: InboundMessage) => void;
      handleEvent?: (event: any) => void;
      handleStatus: (status: { status: string }) => void;
      readConfig?: (key: string) => Promise<unknown>;
      writeConfig?: (key: string, value: unknown) => Promise<void>;
    }) {
      const xalgoConfig = config.channels?.xalgoVoice ?? config;
      const adapter: StoreAdapter = {
        read: readConfig ?? (async (k) => xalgoConfig[k.split(".").pop()!]),
        write: writeConfig ?? (async () => {
          log.warn("writeConfig not provided, binding updates will not persist");
        }),
      };
      const store = createBindingStore(adapter);
      channel = new XalgoVoiceChannel(xalgoConfig, store);
      await channel.start({ handleMessage, handleStatus });
      handleStatus({ status: "ready" });
    },

    async stop() {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },
  };
}
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run test/unit/client-instance-id.test.ts`
Expected: PASS（2 test）

Run: `npm test`
Expected: 全部 PASS（已有集成测试可能因构造器签名变化失败，需要在下个 step 修）

- [ ] **Step 6: 修复其它测试中的构造器调用**

集成测试 `test/integration/mock-server.ts` 不直接构造 XvcClient，但 `test/integration/connect.test.ts` 和 `test/integration/message-flow.test.ts` 如果有构造 `XalgoVoiceChannel`，需要补 store 参数。

Run: `npx vitest run test/integration/`
找到所有 `new XalgoVoiceChannel(...)` 调用，给每个补一个 in-memory binding-store stub：

```typescript
import { createBindingStore } from "../../src/binding-store.js";

const memory: Record<string, unknown> = {
  "channels.xalgoVoice.token": "test_token",
  "channels.xalgoVoice.instanceId": "oc_test_instance",
  "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
  "channels.xalgoVoice.boundUserId": "u_test",
};
const store = createBindingStore({
  read: async (k) => memory[k],
  write: async (k, v) => { memory[k] = v; },
});

const channel = new XalgoVoiceChannel(config, store);
```

- [ ] **Step 7: 运行所有测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/client.ts src/channel.ts test/unit/client-instance-id.test.ts test/integration/
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(client): inject instance_id from BindingStore"
```

---

# P2 控制事件

## Task 9：在 `src/protocol.ts` 新增 4 个 control_event 类型

**Files:**
- Modify: `src/protocol.ts`（追加 4 个 type 字面量 + 4 个 payload interface）

- [ ] **Step 1: 写失败的测试**

创建 `test/unit/protocol-control.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { parseEvent, type XvcEvent, type BindingRevokedPayload, type TokenRotatedNotifyPayload } from "../../src/protocol.js";

describe("protocol: control events", () => {
  it("parses binding_revoked event", () => {
    const raw = JSON.stringify({
      event_id: "evt_1",
      type: "binding_revoked",
      created_at: 1700000000000,
      idempotency_key: "idem_1",
      payload: {
        binding_id: "b_1",
        reason: "user_unbound",
        revoked_at: "2026-05-15T00:00:00Z",
      },
    });
    const event = parseEvent(raw) as XvcEvent<BindingRevokedPayload> | null;
    expect(event).not.toBeNull();
    expect(event!.type).toBe("binding_revoked");
    expect(event!.payload.reason).toBe("user_unbound");
  });

  it("parses token_rotated_notify event", () => {
    const raw = JSON.stringify({
      event_id: "evt_2",
      type: "token_rotated_notify",
      created_at: 1700000000000,
      idempotency_key: "idem_2",
      payload: {
        binding_id: "b_1",
        request_id: "req_1",
        initiated_by: "user",
        grace_period_sec: 60,
      },
    });
    const event = parseEvent(raw) as XvcEvent<TokenRotatedNotifyPayload> | null;
    expect(event).not.toBeNull();
    expect(event!.type).toBe("token_rotated_notify");
    expect(event!.payload.grace_period_sec).toBe(60);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/protocol-control.test.ts`
Expected: FAIL（payload 类型不存在）

- [ ] **Step 3: 修改 `src/protocol.ts`**

把 `XvcEventType` 类型补上 4 个新值：

```typescript
export type XvcEventType =
  | "connect"
  | "connected"
  | "ping"
  | "pong"
  | "resume"
  | "resumed"
  | "inbound_message"
  | "outbound_message"
  | "outbound_delta"
  | "confirmation_request"
  | "confirmation_response"
  | "voice_interrupt"
  | "delivery_ack"
  | "task_started"
  | "task_done"
  | "error"
  // 控制事件（spec §7）
  | "binding_revoked"
  | "token_rotated_notify"
  | "binding_metadata_updated"
  | "server_announcement";
```

在文件末尾（`createEvent` 之前）追加 4 个 payload 接口：

```typescript
export interface BindingRevokedPayload {
  binding_id: string;
  reason:
    | "user_unbound"
    | "admin_revoked"
    | "suspicious_activity"
    | "user_account_deleted";
  revoked_at: string;
  message?: string;
}

export interface TokenRotatedNotifyPayload {
  binding_id: string;
  request_id: string;
  initiated_by: "user" | "system";
  grace_period_sec: number;
}

export interface BindingMetadataUpdatedPayload {
  binding_id: string;
  changes: {
    device_label?: string;
  };
}

export interface ServerAnnouncementPayload {
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  action_url?: string;
  expires_at?: string;
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run test/unit/protocol-control.test.ts`
Expected: PASS（2 test）

Run: `npx vitest run test/`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/protocol.ts test/unit/protocol-control.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(protocol): add 4 control_event types"
```

---

## Task 10：创建 `src/control-events.ts`

**Files:**
- Create: `src/control-events.ts`
- Test: `test/unit/control-events.test.ts`

- [ ] **Step 1: 写失败的单元测试**

创建 `test/unit/control-events.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createControlEventHandler } from "../../src/control-events.js";
import type { BindingStore } from "../../src/binding-store.js";
import type { RestClient } from "../../src/rest-client.js";

function makeBindingStore(initial?: { token: string; instanceId: string }): BindingStore {
  let state = initial
    ? {
        token: initial.token,
        instanceId: initial.instanceId,
        boundAt: "2026-05-15T00:00:00Z",
        boundUserId: "u_1",
      }
    : null;
  return {
    read: async () => state,
    write: async (s) => {
      state = s;
    },
    updateToken: async (t) => {
      if (state) state.token = t;
    },
    clear: async () => {
      state = null;
    },
    isBound: async () => state !== null,
  };
}

function makeRestClient(behaviors: Partial<RestClient> = {}): RestClient {
  return {
    exchange: vi.fn(),
    rotate: vi.fn().mockResolvedValue({ channelToken: "new_token" }),
    unbind: vi.fn(),
    ...behaviors,
  } as unknown as RestClient;
}

describe("control-events: binding_revoked", () => {
  it("clears local binding and calls onBindingLost", async () => {
    const store = makeBindingStore({ token: "t", instanceId: "i" });
    const restClient = makeRestClient();
    const onBindingLost = vi.fn();
    const disableReconnect = vi.fn();

    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost,
      disableReconnect,
    });

    await handler.handleBindingRevoked({
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "2026-05-15T00:00:00Z",
    });

    expect(disableReconnect).toHaveBeenCalled();
    expect(await store.isBound()).toBe(false);
    expect(onBindingLost).toHaveBeenCalledWith("user_unbound");
  });

  it("is idempotent: handling twice with same event_id is no-op", async () => {
    const store = makeBindingStore({ token: "t", instanceId: "i" });
    const onBindingLost = vi.fn();
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient: makeRestClient(),
      onBindingLost,
      disableReconnect: vi.fn(),
    });

    await handler.handleBindingRevoked(
      { binding_id: "b_1", reason: "user_unbound", revoked_at: "ts" },
      "evt_dup"
    );
    await handler.handleBindingRevoked(
      { binding_id: "b_1", reason: "user_unbound", revoked_at: "ts" },
      "evt_dup"
    );
    expect(onBindingLost).toHaveBeenCalledTimes(1);
  });
});

describe("control-events: token_rotated_notify", () => {
  it("calls restClient.rotate and updates token via store", async () => {
    const store = makeBindingStore({ token: "old", instanceId: "i" });
    const rotate = vi.fn().mockResolvedValue({ channelToken: "new" });
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect(rotate).toHaveBeenCalledWith("old", "i");
    expect((await store.read())?.token).toBe("new");
  });

  it("leaves old token when rotate fails", async () => {
    const store = makeBindingStore({ token: "old", instanceId: "i" });
    const rotate = vi.fn().mockRejectedValue(new Error("server_error"));
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect((await store.read())?.token).toBe("old");
  });

  it("skips rotate when no binding exists (already revoked locally)", async () => {
    const store = makeBindingStore(); // empty
    const rotate = vi.fn();
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect(rotate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/control-events.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 `src/control-events.ts`**

```typescript
import type { BindingStore } from "./binding-store.js";
import type { RestClient } from "./rest-client.js";
import type {
  BindingRevokedPayload,
  TokenRotatedNotifyPayload,
  BindingMetadataUpdatedPayload,
  ServerAnnouncementPayload,
} from "./protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("control-events");

const PROCESSED_EVENT_LRU_SIZE = 100;

export interface ControlEventDeps {
  bindingStore: BindingStore;
  restClient: RestClient;
  /** 失去绑定时通知上层（清 reconnect、上抛 status） */
  onBindingLost: (reason: BindingRevokedPayload["reason"]) => void;
  /** 停止重连定时器 */
  disableReconnect: () => void;
}

export interface ControlEventHandler {
  handleBindingRevoked: (payload: BindingRevokedPayload, eventId?: string) => Promise<void>;
  handleTokenRotatedNotify: (payload: TokenRotatedNotifyPayload, eventId?: string) => Promise<void>;
  handleMetadataUpdated: (payload: BindingMetadataUpdatedPayload, eventId?: string) => Promise<void>;
  handleAnnouncement: (payload: ServerAnnouncementPayload, eventId?: string) => Promise<void>;
}

export function createControlEventHandler(deps: ControlEventDeps): ControlEventHandler {
  const processedIds = new Set<string>();
  const processedOrder: string[] = [];

  function isAlreadyProcessed(eventId?: string): boolean {
    if (!eventId) return false;
    if (processedIds.has(eventId)) return true;
    processedIds.add(eventId);
    processedOrder.push(eventId);
    if (processedOrder.length > PROCESSED_EVENT_LRU_SIZE) {
      const oldest = processedOrder.shift();
      if (oldest) processedIds.delete(oldest);
    }
    return false;
  }

  return {
    async handleBindingRevoked(payload, eventId) {
      if (isAlreadyProcessed(eventId)) {
        log.debug(`Duplicate binding_revoked event_id=${eventId}, skipping`);
        return;
      }
      log.warn(`Binding revoked: ${payload.reason}`, payload);
      deps.disableReconnect();
      await deps.bindingStore.clear();
      deps.onBindingLost(payload.reason);
    },

    async handleTokenRotatedNotify(payload, eventId) {
      if (isAlreadyProcessed(eventId)) {
        log.debug(`Duplicate token_rotated_notify event_id=${eventId}, skipping`);
        return;
      }
      const binding = await deps.bindingStore.read();
      if (!binding) {
        log.warn("Received token_rotated_notify but no local binding, skipping");
        return;
      }
      try {
        const { channelToken: newToken } = await deps.restClient.rotate(
          binding.token,
          binding.instanceId
        );
        await deps.bindingStore.updateToken(newToken);
        log.info("Token rotated successfully");
      } catch (err) {
        log.error(`Token rotate failed: ${(err as Error).message}`);
        // 留旧 token，服务端 grace_period 后会失效
      }
    },

    async handleMetadataUpdated(payload, eventId) {
      if (isAlreadyProcessed(eventId)) return;
      log.info("Binding metadata updated", payload.changes);
      // MVP 阶段仅记录日志，不写盘
    },

    async handleAnnouncement(payload, eventId) {
      if (isAlreadyProcessed(eventId)) return;
      log.info(`[${payload.level.toUpperCase()}] ${payload.title}: ${payload.body}`);
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/unit/control-events.test.ts`
Expected: PASS（5 test 全过）

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/control-events.ts test/unit/control-events.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(control): add control_event handler with LRU dedup"
```

---

## Task 11：在 `src/client.ts` dispatch 中接入 control_event

**Files:**
- Modify: `src/client.ts`（ClientEvents 扩展 + handleMessage 分支 + disableReconnect 方法）

- [ ] **Step 1: 写失败的测试**

创建 `test/unit/client-control-dispatch.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgoVoice.token": "t",
    "channels.xalgoVoice.instanceId": "oc_test",
    "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
    "channels.xalgoVoice.boundUserId": "u_1",
  };
  return createBindingStore({
    read: async (k) => data[k],
    write: async (k, v) => {
      data[k] = v;
    },
  });
}

describe("XvcClient dispatch: control_event", () => {
  it("invokes onControlEvent for binding_revoked", async () => {
    const onControlEvent = vi.fn();
    const cfg = resolveConfig({ token: "t" });
    const store = makeStore();
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {}, onControlEvent },
      store
    );

    const evt = createEvent("binding_revoked", {
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "ts",
    });
    // 调用私有 handleMessage（通过 ws 不方便，直接 expose 一个 dispatch 方法用于测试）
    (client as any).dispatchControlEvent(evt);

    expect(onControlEvent).toHaveBeenCalledOnce();
    expect(onControlEvent.mock.calls[0][0].type).toBe("binding_revoked");
  });

  it("disableReconnect prevents future scheduleReconnect from running", () => {
    const cfg = resolveConfig({ token: "t" });
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      makeStore()
    );
    client.disableReconnect();
    expect((client as any).reconnectDisabled).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/client-control-dispatch.test.ts`
Expected: FAIL（onControlEvent 不存在 / disableReconnect 不存在）

- [ ] **Step 3: 修改 `src/client.ts`**

在 `ClientEvents` 接口加 `onControlEvent` 和 `onBindingMissing`：

```typescript
export interface ClientEvents {
  onEvent: (event: XvcEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onControlEvent?: (event: XvcEvent) => void;
  onBindingMissing?: () => void;
}
```

在 `XvcClient` 类里新增字段和方法：

```typescript
private reconnectDisabled = false;

disableReconnect(): void {
  this.reconnectDisabled = true;
  this.reconnect.cancel();
}

/** 测试用：直接派发一个 control_event，跳过 ws 层 */
dispatchControlEvent(event: XvcEvent): void {
  this.events.onControlEvent?.(event);
}
```

修改 `scheduleReconnect` 检查 disabled：

```typescript
private scheduleReconnect(): void {
  if (this.reconnectDisabled) {
    log.info("Reconnect disabled, skipping");
    return;
  }
  log.info(`Scheduling reconnect in ${this.reconnect.nextDelay()}ms`);
  this.reconnect.schedule(() => this.connect());
}
```

修改 `handleMessage` 增加 control_event 分支：

```typescript
private handleMessage(raw: string): void {
  const event = parseEvent(raw);
  if (!event) {
    log.warn("Received malformed message, skipping");
    return;
  }

  this.reconnect.recordEventId(event.event_id);

  switch (event.type) {
    case "connected": {
      const payload = event.payload as ConnectedPayload;
      this.reconnect.recordConnectionId(payload.connection_id);
      this.heartbeatIntervalMs = payload.heartbeat_interval_ms;
      this.reconnect.reset();
      this.startHeartbeat();
      this.setStatus("connected");
      log.info(`Authenticated, connection_id=${payload.connection_id}`);
      break;
    }
    case "resumed": {
      this.reconnect.reset();
      this.startHeartbeat();
      this.setStatus("connected");
      log.info("Session resumed");
      break;
    }
    case "pong": {
      this.missedPongs = 0;
      break;
    }
    case "error": {
      this.handleErrorEvent(event.payload as { code: string; message: string });
      break;
    }
    // control_event：不走业务 dispatchEvent，直接路由给上层
    case "binding_revoked":
    case "token_rotated_notify":
    case "binding_metadata_updated":
    case "server_announcement": {
      this.events.onControlEvent?.(event);
      return; // 不再调用通用 events.onEvent
    }
    default:
      break;
  }

  this.events.onEvent(event);
}

private handleErrorEvent(errPayload: { code: string; message: string }): void {
  if (errPayload.code === "AUTH_FAILED") {
    log.error(`Authentication failed: ${errPayload.message}, stopping reconnect`);
    this.setStatus("auth_failed");
    this.disconnect();
    return;
  }
  log.error(`Server error: ${errPayload.code} - ${errPayload.message}`);
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run test/unit/client-control-dispatch.test.ts`
Expected: PASS（2 test）

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/client.ts test/unit/client-control-dispatch.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(client): dispatch control_event to onControlEvent + disableReconnect"
```

---

## Task 12：在 `src/channel.ts` 中接入 control-events handler

**Files:**
- Modify: `src/channel.ts`（构造 ControlEventHandler，转发 status）

- [ ] **Step 1: 写失败的测试**

创建 `test/unit/channel-control.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { XalgoVoiceChannel } from "../../src/channel.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgoVoice.token": "t",
    "channels.xalgoVoice.instanceId": "oc_test",
    "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
    "channels.xalgoVoice.boundUserId": "u_1",
  };
  return {
    store: createBindingStore({
      read: async (k) => data[k],
      write: async (k, v) => {
        data[k] = v;
      },
    }),
    data,
  };
}

describe("XalgoVoiceChannel + control events", () => {
  it("on binding_revoked: clears local binding and emits unbound status", async () => {
    const { store, data } = makeStore();
    const statusUpdates: string[] = [];

    const channel = new XalgoVoiceChannel(
      { token: "t", apiBaseUrl: "https://api.example.com" } as any,
      store
    );

    await channel.start({
      handleMessage: () => {},
      handleStatus: (s) => statusUpdates.push(s.status),
    });

    const evt = createEvent("binding_revoked", {
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "ts",
    });

    // 直接通过 client 的 onControlEvent 注入
    (channel as any).client.dispatchControlEvent(evt);

    // 等待异步 handler 完成
    await new Promise((r) => setTimeout(r, 50));

    expect(data["channels.xalgoVoice.token"]).toBe("");
    expect(statusUpdates).toContain("unbound");

    await channel.stop();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/channel-control.test.ts`
Expected: FAIL（channel 还没接入 control-events）

- [ ] **Step 3: 修改 `src/channel.ts`**

在 `src/channel.ts` 顶部新增 imports：

```typescript
import { createControlEventHandler, type ControlEventHandler } from "./control-events.js";
import { createRestClient, type RestClient } from "./rest-client.js";
import type { BindingRevokedPayload, TokenRotatedNotifyPayload, BindingMetadataUpdatedPayload, ServerAnnouncementPayload } from "./protocol.js";
```

在 `XalgoVoiceChannel` 类里新增字段：

```typescript
private bindingStore: BindingStore;
private restClient: RestClient;
private controlEvents: ControlEventHandler;
```

修改构造器：

```typescript
constructor(
  rawConfig: Partial<XalgoVoiceConfig> & { token: string },
  bindingStore: BindingStore
) {
  this.config = resolveConfig(rawConfig);
  this.bindingStore = bindingStore;
  this.restClient = createRestClient(this.config.apiBaseUrl);
  this.streaming = new StreamingManager();
  this.confirmation = new ConfirmationManager();
  this.interrupt = new InterruptHandler();
  this.delivery = new DeliveryTracker();

  this.controlEvents = createControlEventHandler({
    bindingStore: this.bindingStore,
    restClient: this.restClient,
    onBindingLost: (reason) => {
      log.warn(`Binding lost: ${reason}`);
      this.callbacks?.handleStatus({ status: "unbound" });
    },
    disableReconnect: () => this.client.disableReconnect(),
  });

  this.client = new XvcClient(
    this.config,
    {
      onEvent: (event) => this.dispatchEvent(event),
      onStatusChange: (status) => this.handleStatusChange(status),
      onControlEvent: (event) => this.dispatchControlEvent(event),
    },
    bindingStore
  );

  this.interrupt.onCancelRun((messageId) => {
    this.streaming.cancelStream(messageId);
    log.info(`Cancelled stream for interrupted message: ${messageId}`);
  });

  this.confirmation.onResolve((response) => {
    log.info(`Confirmation ${response.confirmation_id} resolved: ${response.result}`);
  });
}
```

新增私有方法 `dispatchControlEvent`：

```typescript
private dispatchControlEvent(event: XvcEvent): void {
  switch (event.type) {
    case "binding_revoked":
      this.controlEvents
        .handleBindingRevoked(event.payload as BindingRevokedPayload, event.event_id)
        .catch((err) => log.error("handleBindingRevoked failed", err));
      break;
    case "token_rotated_notify":
      this.controlEvents
        .handleTokenRotatedNotify(event.payload as TokenRotatedNotifyPayload, event.event_id)
        .catch((err) => log.error("handleTokenRotatedNotify failed", err));
      break;
    case "binding_metadata_updated":
      this.controlEvents
        .handleMetadataUpdated(event.payload as BindingMetadataUpdatedPayload, event.event_id)
        .catch((err) => log.error("handleMetadataUpdated failed", err));
      break;
    case "server_announcement":
      this.controlEvents
        .handleAnnouncement(event.payload as ServerAnnouncementPayload, event.event_id)
        .catch((err) => log.error("handleAnnouncement failed", err));
      break;
    default:
      log.warn(`Unknown control event type: ${event.type}`);
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run test/unit/channel-control.test.ts`
Expected: PASS

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/channel.ts test/unit/channel-control.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(channel): wire control_event handler into channel"
```

---

## Task 13：扩展 `mock-server.ts` 支持 control_event 推送

**Files:**
- Modify: `test/integration/mock-server.ts`

- [ ] **Step 1: 在 mock-server.ts 添加推送 control_event 的方法**

在 `MockXalgoServer` 类内找到 `sendInboundMessage` 方法附近，新增：

```typescript
import { createEvent, type BindingRevokedPayload, type TokenRotatedNotifyPayload } from "../../src/protocol.js";

// 在类里添加：

pushBindingRevoked(
  bindingId: string = "b_test",
  reason: BindingRevokedPayload["reason"] = "user_unbound"
): void {
  this.sendToAll(
    createEvent("binding_revoked", {
      binding_id: bindingId,
      reason,
      revoked_at: new Date().toISOString(),
    })
  );
}

pushTokenRotatedNotify(bindingId: string = "b_test"): void {
  this.sendToAll(
    createEvent("token_rotated_notify", {
      binding_id: bindingId,
      request_id: `req_${Date.now()}`,
      initiated_by: "user",
      grace_period_sec: 60,
    })
  );
}

closeConnection(code: number = 1000, reason: string = "test close"): void {
  for (const client of this.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(code, reason);
    }
  }
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npm run lint`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add test/integration/mock-server.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "test(mock-server): add pushBindingRevoked/pushTokenRotatedNotify methods"
```

---

# P3 鉴权增强 + 端到端验证

## Task 14：`XvcClient` 处理 connect 阶段的鉴权细分错误

**Files:**
- Modify: `src/client.ts`（handleErrorEvent 细分 reason）

- [ ] **Step 1: 写失败的测试**

创建 `test/unit/client-auth-errors.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgoVoice.token": "t",
    "channels.xalgoVoice.instanceId": "oc_test",
    "channels.xalgoVoice.boundAt": "ts",
    "channels.xalgoVoice.boundUserId": "u_1",
  };
  return { store: createBindingStore({ read: async (k) => data[k], write: async (k, v) => { data[k] = v; } }), data };
}

describe("XvcClient auth_failed reasons", () => {
  it("binding_revoked → status auth_failed, disable reconnect, emit control event", () => {
    const { store } = makeStore();
    const onControlEvent = vi.fn();
    const onStatusChange = vi.fn();
    const client = new XvcClient(
      resolveConfig({ token: "t" }),
      { onEvent: () => {}, onStatusChange, onControlEvent },
      store
    );

    (client as any).handleErrorEvent({
      code: "AUTH_FAILED",
      message: "binding revoked",
      reason: "binding_revoked",
    });

    expect(onStatusChange).toHaveBeenCalledWith("auth_failed");
    expect((client as any).reconnectDisabled).toBe(true);
  });

  it("instance_mismatch → emit dedicated warning + status auth_failed", () => {
    const { store } = makeStore();
    const onStatusChange = vi.fn();
    const onControlEvent = vi.fn();
    const client = new XvcClient(
      resolveConfig({ token: "t" }),
      { onEvent: () => {}, onStatusChange, onControlEvent },
      store
    );

    (client as any).handleErrorEvent({
      code: "AUTH_FAILED",
      message: "instance mismatch",
      reason: "instance_mismatch",
    });

    expect(onStatusChange).toHaveBeenCalledWith("auth_failed");
    expect((client as any).reconnectDisabled).toBe(true);
    // instance_mismatch 也走 onControlEvent，让上层做风控告警
    expect(onControlEvent).toHaveBeenCalled();
    const evt = onControlEvent.mock.calls[0][0];
    expect(evt.type).toBe("binding_revoked");
    expect(evt.payload.reason).toBe("suspicious_activity");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/unit/client-auth-errors.test.ts`
Expected: FAIL

- [ ] **Step 3: 修改 `src/client.ts`** 

替换 `handleErrorEvent` 方法：

```typescript
import { createEvent } from "./protocol.js"; // 已有

private handleErrorEvent(errPayload: {
  code: string;
  message: string;
  reason?: string;
}): void {
  if (errPayload.code === "AUTH_FAILED") {
    const reason = errPayload.reason ?? "token_invalid";
    log.error(`Authentication failed: reason=${reason}, message=${errPayload.message}`);
    this.setStatus("auth_failed");
    this.disableReconnect();

    if (reason === "instance_mismatch") {
      // 上抛为 control event，触发上层风控（清 binding + 告警）
      const synth = createEvent("binding_revoked", {
        binding_id: "unknown",
        reason: "suspicious_activity",
        revoked_at: new Date().toISOString(),
        message: errPayload.message,
      });
      this.events.onControlEvent?.(synth);
    } else if (reason === "binding_revoked" || reason === "token_invalid") {
      const synth = createEvent("binding_revoked", {
        binding_id: "unknown",
        reason: "user_unbound",
        revoked_at: new Date().toISOString(),
        message: errPayload.message,
      });
      this.events.onControlEvent?.(synth);
    }

    this.disconnect();
    return;
  }
  log.error(`Server error: ${errPayload.code} - ${errPayload.message}`);
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run test/unit/client-auth-errors.test.ts`
Expected: PASS（2 test）

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add src/client.ts test/unit/client-auth-errors.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "feat(client): split AUTH_FAILED into binding_revoked/instance_mismatch reasons"
```

---

## Task 15：端到端集成测试 - 绑定→运行→服务端推 revoke→清理

**Files:**
- Create: `test/integration/binding-flow.test.ts`

- [ ] **Step 1: 创建端到端集成测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockXalgoServer } from "./mock-server.js";
import { XalgoVoiceChannel } from "../../src/channel.js";
import { createBindingStore } from "../../src/binding-store.js";

describe("Integration: binding lifecycle", () => {
  let mock: MockXalgoServer;
  let port: number;

  beforeEach(async () => {
    mock = new MockXalgoServer({ heartbeatIntervalMs: 5000 });
    port = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it("happy path: connect with stored binding → exchange messages → server revokes → channel emits unbound status", async () => {
    const memoryConfig: Record<string, unknown> = {
      "channels.xalgoVoice.token": "test_token",
      "channels.xalgoVoice.instanceId": "oc_test_inst",
      "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
      "channels.xalgoVoice.boundUserId": "u_1",
      "channels.xalgoVoice.boundUserName": "杨立",
    };
    const store = createBindingStore({
      read: async (k) => memoryConfig[k],
      write: async (k, v) => {
        memoryConfig[k] = v;
      },
    });

    const statusUpdates: string[] = [];
    const messages: unknown[] = [];

    const channel = new XalgoVoiceChannel(
      {
        token: "test_token",
        serverUrl: `ws://localhost:${port}`,
        apiBaseUrl: "https://api.example.com",
      } as any,
      store
    );

    await channel.start({
      handleMessage: (msg) => messages.push(msg),
      handleStatus: (s) => statusUpdates.push(s.status),
    });

    // 等待 mock-server 回应 connected
    await new Promise((r) => setTimeout(r, 300));

    // 发一条 inbound message
    mock.sendInboundMessage("hello");
    await new Promise((r) => setTimeout(r, 200));
    expect(messages.length).toBeGreaterThan(0);

    // 服务端推 binding_revoked
    mock.pushBindingRevoked("b_1", "user_unbound");
    await new Promise((r) => setTimeout(r, 300));

    // 验证本地清空 + 状态切到 unbound
    expect(memoryConfig["channels.xalgoVoice.token"]).toBe("");
    expect(memoryConfig["channels.xalgoVoice.instanceId"]).toBe("");
    expect(statusUpdates).toContain("unbound");

    await channel.stop();
  }, 10000);

  it("server pushes token_rotated_notify → channel attempts rotate via REST", async () => {
    // 由于此测试需要真实 REST 请求，mock 通过 vi.spyOn(globalThis, "fetch")
    const { vi } = await import("vitest");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ channel_token: "new_token_after_rotate" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const memoryConfig: Record<string, unknown> = {
        "channels.xalgoVoice.token": "old_token",
        "channels.xalgoVoice.instanceId": "oc_test_inst",
        "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
        "channels.xalgoVoice.boundUserId": "u_1",
      };
      const store = createBindingStore({
        read: async (k) => memoryConfig[k],
        write: async (k, v) => {
          memoryConfig[k] = v;
        },
      });

      const channel = new XalgoVoiceChannel(
        {
          token: "old_token",
          serverUrl: `ws://localhost:${port}`,
          apiBaseUrl: "https://api.example.com",
        } as any,
        store
      );

      await channel.start({ handleMessage: () => {}, handleStatus: () => {} });
      await new Promise((r) => setTimeout(r, 300));

      mock.pushTokenRotatedNotify("b_1");
      await new Promise((r) => setTimeout(r, 300));

      expect(memoryConfig["channels.xalgoVoice.token"]).toBe("new_token_after_rotate");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/v1/openclaw/bindings/rotate");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer old_token");

      await channel.stop();
    } finally {
      globalThis.fetch = original;
    }
  }, 10000);
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run test/integration/binding-flow.test.ts`
Expected: PASS（2 test）

Run: `npm test`
Expected: 所有测试通过

Run: `npm run lint`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add test/integration/binding-flow.test.ts
"/d/Program Files/Git/cmd/git.exe" commit -m "test(integration): end-to-end binding lifecycle"
```

---

## Task 16：更新 README 和文档

**Files:**
- Modify: `README.md`（绑定流程章节）

- [ ] **Step 1: 修改 README.md 配置章节**

定位 `## 配置` 章节（约第 37 行起），替换"获取绑定码 / 配置向导 / 手动配置"三小节为：

```markdown
## 配置

### 1. 在 Xalgo App 生成绑定码

打开 Xalgo App，点击「连接 OpenClaw」，App 会显示一个 **8 位绑定码**（5 分钟内有效）。

### 2. 在 OpenClaw 运行配置向导

```bash
openclaw plugins setup xalgo-voice
```

向导会引导：

1. 输入 8 位绑定码（不区分大小写）
2. 输入 API Server 地址（默认 `https://channel.xalgo.ai`）
3. 显示要绑定到的 Xalgo 账号，确认 `[y/N]`
4. 自动写入配置文件并建立 WebSocket 连接

### 3. 设备管理

绑定成功后：

- 在 **Xalgo App → 设备列表** 可以查看已绑定的 OpenClaw、修改设备名、解绑、Rotate Token
- 在 **OpenClaw 终端** 重新运行 `openclaw plugins setup xalgo-voice` 可以选择「保持现状 / 重新绑定 / 解绑」

### 4. 安全说明

- Channel Token 与本地 `instance_id` 双因子鉴权：Token 即使被复制到另一台机器也无法使用
- App 端主动解绑后，插件秒级感知并自动清空本地凭据
- 5 分钟内绑定码累计验证失败 ≥5 次即作废
```

并保留原 README 的其余内容不变。

- [ ] **Step 2: 提交**

```bash
"/d/Program Files/Git/cmd/git.exe" add README.md
"/d/Program Files/Git/cmd/git.exe" commit -m "docs: update README with new binding flow"
```

---

## Task 17：最终回归 + 整理

**Files:**
- 无新文件

- [ ] **Step 1: 完整测试套件**

Run: `npm test`
Expected: 所有测试 PASS（含 P1/P2/P3 共约 30+ test）

Run: `npm run lint`
Expected: 无错误

Run: `npm run build`
Expected: 编译成功，生成 `dist/`

- [ ] **Step 2: 手动验证 setup 流程（可选）**

如果有 mock server 跑起来，可以手动 invoke `setup-entry.ts` 的 `setup()` 函数，验证：

1. 无绑定 + 有效码 + 确认 → 成功写盘
2. 有绑定 + 选 1 → 保持现状
3. 有绑定 + 选 3 → 调用 DELETE /bindings/me + 清空本地

- [ ] **Step 3: 检查无遗留改动**

```bash
"/d/Program Files/Git/cmd/git.exe" status --short
```

Expected: 空（所有改动已提交）

- [ ] **Step 4: 查看分支提交历史**

```bash
"/d/Program Files/Git/cmd/git.exe" log --oneline -25
```

Expected: 看到 P1/P2/P3 共约 17 个 commit

---

## 实施完成检查清单

实施完毕后，对照 spec 检查覆盖：

- [ ] P1 基础绑定
  - [ ] `src/config.ts` 字段扩展（Task 1）
  - [ ] `src/types/openclaw.d.ts` SetupContext（Task 2）
  - [ ] `src/binding-store.ts` + 单测（Task 3）
  - [ ] `src/rest-client.ts` + 单测（Task 4-6）
  - [ ] `setup-entry.ts` 重写 + 单测（Task 7）
  - [ ] `src/client.ts` instance_id 注入（Task 8）
- [ ] P2 控制事件
  - [ ] `src/protocol.ts` 新增 4 个 type（Task 9）
  - [ ] `src/control-events.ts` + 单测（Task 10）
  - [ ] `src/client.ts` dispatch 分支 + onControlEvent（Task 11）
  - [ ] `src/channel.ts` 接入 ControlEventHandler（Task 12）
  - [ ] `mock-server.ts` 推送能力（Task 13）
- [ ] P3 鉴权增强
  - [ ] `src/client.ts` AUTH_FAILED 细分（Task 14）
  - [ ] 端到端集成测试（Task 15）
  - [ ] 文档更新（Task 16）

---

## 不在本计划范围内（P4-P5，后续迭代）

- 服务端 App 侧 API（`/v1/app/bindings/*`）— spec §5.4，不在本插件 scope
- `binding_metadata_updated` UI 表现（仅日志）
- `server_announcement` UI 表现（仅日志）
- 速率限制（服务端职责）
- 审计日志规范（服务端职责）
- `instance_mismatch` 自动 `revoked + reason=suspicious_activity` 阈值告警（服务端职责）
- 多 OpenClaw 实例间的消息路由策略（spec §14 开放问题）
- 多进程同时启动的 file lock 保护（spec §8.4 持久化容错）— 视实际部署形态再加
