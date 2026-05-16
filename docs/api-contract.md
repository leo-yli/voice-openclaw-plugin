# OpenClaw 插件 ↔ 服务端 API 契约

> **目的**：供 Xalgo Channel Server 工程师对照实现。本文档罗列 `@xalgo/voice-openclaw-plugin` 当前会发起的**全部**网络请求 / WebSocket 帧，含精确路径、Header、Body、响应 schema、错误码、关键时序约束。

**文档版本**：v1.0
**日期**：2026-05-15
**对应代码**：master 分支 commit `3346571`（schema 对齐）之后
**Base URL**（当前测试环境，来自 `endpoints.json`）：

| 用途 | URL |
|---|---|
| REST API base | `https://asr-test.jlpay.com` |
| WebSocket | `wss://asr-test.jlpay.com/openclaw/connect` |

切换生产环境时只改 `endpoints.json` 一个文件，本契约其它内容不变。

---

## 目录

- [一、HTTPS REST API（3 个 endpoint）](#一https-rest-api3-个-endpoint)
  - [1. POST /v1/openclaw/bindings/exchange](#1-post-v1openclawbindingsexchange)
  - [2. POST /v1/openclaw/bindings/rotate](#2-post-v1openclawbindingsrotate)
  - [3. DELETE /v1/openclaw/bindings/me](#3-delete-v1openclawbindingsme)
- [二、WebSocket 连接与握手](#二websocket-连接与握手)
- [三、运行时业务消息（WebSocket）](#三运行时业务消息websocket)
- [四、错误码字典](#四错误码字典)
- [五、对比 checklist](#五对比-checklist)

---

## 一、HTTPS REST API（3 个 endpoint）

所有 REST API：

- 强制 **HTTPS / TLS 1.2+**
- 请求 / 响应 Content-Type：`application/json`
- 错误响应 Content-Type：`application/problem+json`（RFC 7807）
- 鉴权方式：`Authorization: Bearer <channel_token>` + `X-Instance-Id: <instance_id>`（双因子）
- 失败 5xx 时客户端自动**退避重试 3 次**（1s → 2s → 4s）后抛 `server_error`

---

### 1. `POST /v1/openclaw/bindings/exchange`

**用途**：插件用绑定码换长期 Channel Token + binding 记录创建。**首次绑定唯一入口**，无需鉴权（绑定码本身是身份证明）。

#### Request

```http
POST /v1/openclaw/bindings/exchange HTTP/1.1
Host: asr-test.jlpay.com
Content-Type: application/json
X-Plugin-Version: 2026.5.16
X-Idempotency-Key: idem_<timestamp>_<random>

{
  "code": "A3FK9PQX",
  "instance_id": "oc_550e8400-e29b-41d4-a716-446655440000",
  "device_label": "OpenClaw on yangli-mac",
  "plugin_version": "2026.5.16"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string(8) | 用户在 App 看到的绑定码，已 `toUpperCase()`，字符集 `[A-HJKMNPQRTV-Y3-9]` |
| `instance_id` | string | 插件首次绑定生成的 UUID v4，带 `oc_` 前缀，永久持久化到本地配置 |
| `device_label` | string | `"OpenClaw on " + os.hostname()` |
| `plugin_version` | string | 插件版本号（与 `X-Plugin-Version` header 同值） |

#### Response 200

`Content-Type: application/json`

```json
{
  "channel_token": "xvc_live_aBc...64字节...",
  "token_prefix": "xvc_live_aB",
  "binding_id": "b_7f3e...",
  "user_id": "xalgo_user_123",
  "user_display_name": "杨立",
  "ws_url": "wss://asr-test.jlpay.com/openclaw/connect"
}
```

> ⚠️ 客户端**用 `ws_url` 覆盖** `config.serverUrl`，所以服务端可以在这里返回不同的 ws 地址（多区域路由）。

#### Error Response

`Content-Type: application/problem+json`

| HTTP | `type` | 客户端处理 |
|---|---|---|
| 400 | `invalid_code_format` | 提示用户重输 |
| 401 | `code_not_found` | 提示重输 |
| 401 | `code_attempts_exceeded` | 提示去 App 重新生成码 |
| 410 | `code_expired` | 同上 |
| 410 | `code_consumed` | 同上 |
| 409 | `instance_already_bound` | 提示是否覆盖（rotate） |
| 429 | `rate_limited` | 看 `Retry-After` header（秒）等指定时长 |
| 5xx | (any) | 客户端自动重试 3 次（1s/2s/4s），仍失败抛 `server_error` |

错误响应体示例：

```json
{
  "type": "code_expired",
  "title": "Code expired",
  "detail": "Binding code A3FK9PQX expired at 2026-05-15T10:00:00Z"
}
```

---

### 2. `POST /v1/openclaw/bindings/rotate`

**用途**：插件用旧 token 换新 token，由服务端推 `token_rotated_notify` 控制事件触发。

#### Request

```http
POST /v1/openclaw/bindings/rotate HTTP/1.1
Host: asr-test.jlpay.com
Content-Type: application/json
Authorization: Bearer <old_channel_token>
X-Instance-Id: oc_550e8400-...

{}
```

> 请求体是空对象 `{}`，鉴权信息全在 Header。

#### Response 200

```json
{
  "channel_token": "xvc_live_xYz...(新)"
}
```

> 客户端**当前只使用 `channel_token` 字段**（见 `rest-client.ts:177`）。spec 还设计了 `token_prefix` 和 `rotated_at` 字段，服务端可以返回，客户端会忽略。

#### Error

| HTTP | `type` | 说明 |
|---|---|---|
| 401 | `auth_failed` | 旧 token 已失效 / instance_id 不匹配 |
| 5xx | (auto retry) | 3 次后抛 `server_error` |

#### ⚠️ 服务端关键行为：60 秒 grace_period

响应发出后**保留旧 token 60 秒**，避免插件写盘竞态。60s 后旧 token 单方面失效。

`grace_period_sec` 通过控制事件 `token_rotated_notify.payload.grace_period_sec` 字段传给客户端，**目前固定 60**。

---

### 3. `DELETE /v1/openclaw/bindings/me`

**用途**：插件主动解绑（用户在 OpenClaw setup wizard 选「解绑」）。

#### Request

```http
DELETE /v1/openclaw/bindings/me HTTP/1.1
Host: asr-test.jlpay.com
Authorization: Bearer <channel_token>
X-Instance-Id: oc_550e8400-...
```

无请求体。

#### Response

- **204 No Content** → 客户端清空本地 config
- 401/410 → `ExchangeError(auth_failed)` 等
- 5xx → `ExchangeError(server_error)`，**不重试**（让上层决定）

---

## 二、WebSocket 连接与握手

### 端点

```
wss://asr-test.jlpay.com/openclaw/connect
```

⚠️ 客户端**无 query parameter**，所有鉴权都在握手后的第一个 JSON 帧里（不是 URL query 或 HTTP Authorization header）。

### 通用 envelope

所有 JSON 帧的统一外壳：

```json
{
  "event_id": "evt_<timestamp>_<random>",
  "type": "<event_type>",
  "created_at": 1778120000000,
  "idempotency_key": "idem_<...>",
  "payload": { ... }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_id` | string | 唯一事件 ID，客户端用最近 100 个 ID 做 LRU 幂等去重 |
| `type` | string | 事件类型（见下文枚举） |
| `created_at` | number | Unix timestamp ms |
| `idempotency_key` | string | 幂等键，用于副作用事件去重 |
| `payload` | object | 类型相关数据 |

---

### 2.1 握手帧：插件 → 服务端 `connect`

```json
{
  "event_id": "evt_...",
  "type": "connect",
  "created_at": 1778120000000,
  "idempotency_key": "idem_...",
  "payload": {
    "protocol_version": 1,
    "client": {
      "kind": "openclaw",
      "plugin": "@xalgo/voice-openclaw-plugin",
      "plugin_version": "2026.5.16",
      "instance_id": "oc_550e8400-...",
      "device_name": "OpenClaw on yangli-mac"
    },
    "channel": "xalgo_voice",
    "auth": { "token": "<channel_token>" },
    "capabilities": [
      "text_message",
      "streaming_reply",
      "confirmation",
      "background_notification",
      "voice_interrupt",
      "delivery_ack"
    ]
  }
}
```

⚠️ 服务端**必须 AND 校验** `auth.token` 和 `client.instance_id`（双因子）。任一不匹配 → 推 `error` 事件并关闭连接。

### 2.2 服务端 → 插件 `connected`（握手成功）

```json
{
  "event_id": "...",
  "type": "connected",
  "created_at": ...,
  "idempotency_key": "...",
  "payload": {
    "connection_id": "conn_abc",
    "user_id": "xalgo_user_123",
    "heartbeat_interval_ms": 15000,
    "server_capabilities": ["asr_final", "tts_playback", "phone_confirm_card", "duplex_interrupt"]
  }
}
```

`heartbeat_interval_ms` 控制客户端发 ping 的频率。

### 2.3 鉴权失败：服务端 → 插件 `error`

```json
{
  "type": "error",
  "payload": {
    "code": "AUTH_FAILED",
    "message": "...人类可读说明...",
    "reason": "binding_revoked" | "token_invalid" | "instance_mismatch"
  }
}
```

⚠️ `payload.reason` 字段**非常重要**，客户端按 reason 分支处理：

| `reason` | 客户端动作 |
|---|---|
| `binding_revoked` | 清本地 config，停止重连，回到 idle |
| `token_invalid` | 同上 |
| `instance_mismatch` | ★告警★ 同样清本地，但上抛风控事件（怀疑 token 被复制到其他机器） |
| 未指定 | fallback 视为 `token_invalid` |

### 2.4 断线重连：插件 → 服务端 `resume`

```json
{
  "type": "resume",
  "payload": {
    "connection_id": "<前一次的 conn_id>",
    "last_event_id": "<最后收到的 event_id>",
    "auth": { "token": "<channel_token>" }
  }
}
```

服务端响应 `resumed` 事件（包结构同 `connected` 但只需 confirm 即可）。如果连接太久没法 resume，可以返回 `error` 让客户端走全新 `connect`。

### 2.5 心跳

- **插件 → 服务端**：`{ "type": "ping", "payload": { "ts": <timestamp_ms> } }` 每 `heartbeat_interval_ms` 一次
- **服务端 → 插件**：`{ "type": "pong", "payload": { "ts": <timestamp_ms> } }`
- 客户端**连续 miss 3 个 pong** → 主动断开并触发重连

---

## 三、运行时业务消息（WebSocket）

### 3.1 服务端 → 插件（运行时事件）

| `type` | 业务含义 | 客户端动作 |
|---|---|---|
| `inbound_message` | 用户语音 ASR 文本 | 转发给 OpenClaw Agent |
| `confirmation_response` | 用户对确认请求的响应 | 路由到 pending confirmation |
| `voice_interrupt` | 用户打断 | cancel 当前 stream，转 follow-up 意图 |
| `delivery_ack` | TTS 投递确认 | 更新 playback ledger |

详细 payload 见 `src/protocol.ts:62-146`。本契约未改动这部分 XVC 协议。

### 3.2 服务端 → 插件（控制事件，P2 阶段新增）★

| `type` | 触发时机 | payload 关键字段 |
|---|---|---|
| `binding_revoked` | App 端解绑 / 风控 / 用户注销 | `binding_id`, `reason` (`user_unbound` / `admin_revoked` / `suspicious_activity` / `user_account_deleted`), `revoked_at`, `message?` |
| `token_rotated_notify` | App 端发起 rotate | `binding_id`, `request_id`, `initiated_by` (`user` / `system`), `grace_period_sec` (默认 60) |
| `binding_metadata_updated` | App 端改 device_label 等 | `binding_id`, `changes: { device_label? }` |
| `server_announcement` | 服务端公告 | `level` (`info` / `warning` / `critical`), `title`, `body`, `action_url?`, `expires_at?` |

控制事件 payload 完整 TypeScript 定义：

```typescript
interface BindingRevokedPayload {
  binding_id: string;
  reason:
    | "user_unbound"
    | "admin_revoked"
    | "suspicious_activity"
    | "user_account_deleted";
  revoked_at: string;       // ISO 8601
  message?: string;
}

interface TokenRotatedNotifyPayload {
  binding_id: string;
  request_id: string;
  initiated_by: "user" | "system";
  grace_period_sec: number;
}

interface BindingMetadataUpdatedPayload {
  binding_id: string;
  changes: { device_label?: string };
}

interface ServerAnnouncementPayload {
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  action_url?: string;
  expires_at?: string;
}
```

⚠️ 控制事件 **`event_id` 必须稳定且唯一**：客户端用最近 100 个 event_id 做 LRU 幂等去重，重复推送只处理一次。

### 3.3 插件 → 服务端（业务回复）

| `type` | 用途 |
|---|---|
| `outbound_message` | 一次性回复（非流式） |
| `outbound_delta` | 流式回复增量（含 `delta_seq`, `text_delta`, `span_id`, `is_final`） |
| `confirmation_request` | Agent 请求用户确认（R2+ 操作） |
| `task_started` / `task_done` | 长任务通知 |

详细 schema 见 `src/protocol.ts:78-157`。

---

## 四、错误码字典

REST + WebSocket 鉴权统一错误名表（客户端按这些字符串识别错误并分支处理）：

| 错误名 | 出现位置 | 客户端处理 |
|---|---|---|
| `invalid_code_format` | REST exchange | 8 位格式校验失败 |
| `code_not_found` | REST exchange | 码不存在 |
| `code_attempts_exceeded` | REST exchange | 单码失败 ≥5 次锁死 |
| `code_expired` | REST exchange | 5 分钟过期 |
| `code_consumed` | REST exchange | 码已用过 |
| `instance_already_bound` | REST exchange | 同 user + instance_id 已存在 active binding |
| `rate_limited` | REST 全部 | 配合 `Retry-After` header（秒） |
| `auth_failed` | REST rotate/unbind | 通用 401 |
| `binding_revoked` | WS connect error.reason | binding.status != 'active' |
| `token_invalid` | WS connect error.reason | token_hash 不匹配 |
| `instance_mismatch` | WS connect error.reason | token 有效但 instance_id 不匹配（高危！） |

---

## 五、对比 checklist

请服务端工程师重点核对：

- [ ] **REST 路径**：`/v1/openclaw/bindings/{exchange,rotate,me}` —— `me` 是固定字面量（不是 `:id`）
- [ ] **Header 命名**：`x-instance-id` / `x-plugin-version` / `x-idempotency-key`（lowercase），`Authorization: Bearer ...`（标准）
- [ ] **请求体字段命名**：snake_case (`instance_id` / `device_label` / `plugin_version` / `channel_token` / `user_display_name` / `ws_url`)
- [ ] **错误响应**：`application/problem+json` + `{ "type": "<error_name>", ... }`
- [ ] **rate limit 头**：`Retry-After: <seconds>` (RFC 7231 标准)
- [ ] **WebSocket envelope**：`event_id` / `type` / `created_at` / `idempotency_key` / `payload` 五字段
- [ ] **WebSocket connect 鉴权**：服务端校验 token AND instance_id，错误用 `type=error, payload.code=AUTH_FAILED, payload.reason=...`
- [ ] **rotate 的 60 秒 grace period**：旧 token 在响应后 60s 内仍可用
- [ ] **WebSocket URL 来源优先级**：connect 时插件用 `config.serverUrl`；但 exchange 响应里的 `ws_url` 字段会**覆盖** config 写入新值（支持多区域路由）
- [ ] **控制事件 `event_id` 稳定性**：服务端推送 `binding_revoked` / `token_rotated_notify` 等控制事件时，`event_id` 必须稳定唯一，便于客户端 LRU 幂等去重
- [ ] **App 侧 API** (`/v1/app/bindings/codes` 等，详见设计文档 §5.4)：不在本插件 scope 但需对齐

---

## 附录：相关文档

- 设计文档：[`docs/superpowers/specs/2026-05-15-openclaw-binding-flow-design.md`](./superpowers/specs/2026-05-15-openclaw-binding-flow-design.md)
- 实施计划：[`docs/superpowers/plans/2026-05-15-openclaw-binding-flow.md`](./superpowers/plans/2026-05-15-openclaw-binding-flow.md)
- 配置 schema：[`openclaw.plugin.json`](../openclaw.plugin.json)（与 `src/config.ts` 的 `XalgoVoiceConfig` 接口对齐）
- Endpoints 单一源：[`endpoints.json`](../endpoints.json)

## 反馈方式

服务端与本契约有任何出入，请直接在 `docs/api-contract.md` 上留 review comment，或在项目 issue 系统提 issue 引用本文档章节号（如 §1.1 / §2.3）。
