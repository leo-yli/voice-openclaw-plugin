# OpenClaw 绑定流程设计文档

版本：v1.0
日期：2026-05-15
方案选型：方案 A（HTTPS REST 做绑定/解绑/Rotate，WebSocket 做运行时与控制事件）
依赖：基于 `2026-05-14-museve-voice-channel-design.md` 已确立的 XVC 协议与 Channel Plugin 架构

---

## 1. 概述

本文档定义 `@museve/voice-openclaw-plugin` 如何与 Museve Voice Channel Server 建立绑定关系，覆盖首次绑定、长期鉴权、解绑、Rotate Token、异常处理与安全设计。

### 1.1 解决的问题

现有 `setup-entry.ts` 只支持用户手动复制粘贴一个长期 Token 的最朴素流程：

- 没有过期机制、设备指纹、Token Rotate
- 服务端无法识别 Token 被复制到另一台机器
- 用户解绑无法实时通知正在运行的插件
- `instance_id` 在 `src/client.ts:40` 是每次启动随机生成的 (`oc_${Date.now().toString(36)}`)，无法作为稳定设备标识

### 1.2 设计目标

| 目标 | 衡量 |
|---|---|
| 用户体验对齐主流 SaaS 集成 | 类似 Steam Guard / GitHub `gh auth login` / Telegram BotFather |
| 服务端不存 OpenClaw Gateway Token | 仅存 Museve Channel Token + 关系数据 |
| Token 泄漏到第三方机器无法使用 | 双因子鉴权（Token + instance_id） |
| 用户在 App 解绑后插件秒级感知 | WebSocket control_event 推送 |
| 协议向前兼容 | 复用 XVC envelope，仅新增 4 个事件类型 |

### 1.3 非目标

- 不替换/重写现有 XVC 协议
- 不处理 ASR/TTS/全双工（属于 Pupa Cloud）
- 不处理 OpenClaw Gateway Token 管理
- 不处理 App 端的内部数据模型与 UI

---

## 2. 关键决策摘要

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| D1 | 凭据形态 | 绑定码 → 长期 Token | 兼顾输入便利与长期稳定 |
| D2 | 发起方 | Museve App 出码，OpenClaw 输码 | 与现有 setup wizard prompt UI 契合，App 是用户主入口 |
| D3 | 多设备 | 多台并存 (user_id + instance_id) | 家里 + 公司多台 OpenClaw 场景 |
| D4 | 绑定码格式 | 8 位字母数字（Base32 排除 0/O/1/I/L/S/2/Z）+ 5 分钟过期 | 千亿级组合空间 + 短窗口防爆破 |
| D5 | 绑定码 UI | 仅字符码，无 QR | OpenClaw 是 CLI 进程无摄像头，QR 在此场景无价值 |
| D6 | instance_id 来源 | 插件首次绑定时生成 UUID v4，持久化到配置 | 不依赖 OpenClaw 框架变更，自包含 |
| D7 | Token 安全模型 | 绑定 instance_id，connect 双因子校验 | Token 泄漏到第三方机器无法使用 |
| D8 | 解绑发起方 | App 主导（设备列表→移除） | 用户主入口在 App，对齐智能家居 App UX |
| D9 | Token 生命周期 | 永久不过期 + App 可一键 Rotate | Refresh Token 机制对 MVP 过重 |
| D10 | 通信架构 | REST 做绑定，WebSocket 做运行时 + 控制事件 | 飞书/Telegram/企微的标准模式 |

---

## 3. 架构总览

### 3.1 系统组件图

```
┌──────────────────┐                              ┌──────────────────┐
│  Museve App       │                              │  OpenClaw 进程    │
│  (iOS/Android)   │                              │                  │
│                  │                              │  ┌─────────────┐ │
│  ┌─ 设备管理 ──┐│                              │  │ setup-entry │ │
│  │ 连接OpenClaw││                              │  │   wizard    │ │
│  │ 已绑设备列表││                              │  └──────┬──────┘ │
│  │ 解绑/Rotate ││                              │         │        │
│  └─────────────┘│                              │  ┌──────▼──────┐ │
└────────┬─────────┘                              │  │   client.ts │ │
         │ HTTPS (用户 session)                   │  │  WebSocket  │ │
         │                                        │  └──────┬──────┘ │
         │                                        │         │        │
         │                                        └─────────┼────────┘
         │                                                  │
         │                                                  │ HTTPS (绑定码换token)
         │                                                  │ + WebSocket (XVC运行时)
         ▼                                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Museve Voice Channel Server                                          │
│                                                                      │
│  ┌─ HTTPS REST API ─────────┐    ┌─ WebSocket Endpoint ──────────┐  │
│  │ POST /bindings/codes     │    │ /agent-channel/connect             │  │
│  │ POST /bindings/exchange  │    │   - connect / connected       │  │
│  │ POST /bindings/rotate    │    │   - ping / pong               │  │
│  │ DELETE /bindings/me      │    │   - inbound_message etc.      │  │
│  │ GET  /bindings           │    │   - control_event (NEW)       │  │
│  │ DELETE /bindings/:id     │    │     · binding_revoked         │  │
│  └────────────┬─────────────┘    │     · token_rotated_notify    │  │
│               │                  └──────────────┬────────────────┘  │
│               └────────────┬────────────────────┘                   │
│                            ▼                                        │
│              ┌─────────────────────────────┐                        │
│              │  Bindings Store + PubSub    │                        │
│              │  - binding_codes (TTL 5min) │                        │
│              │  - bindings (永久)           │                        │
│              │  - online_connections       │                        │
│              └─────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 三方职责切分

| 组件 | 在绑定流程里干什么 | 不干什么 |
|---|---|---|
| **Museve App** | 用户点"连接 OpenClaw"；调云端生成 8 位绑定码；显示码 + 倒计时 + 刷新；设备列表 / 解绑 / Rotate 入口 | 不直接跟 OpenClaw 通信，所有操作走云端 |
| **Channel Server** | 生成/校验绑定码；维护 bindings 表；验证 connect 双因子；通过 WS 推 control_event | 不存 OpenClaw Gateway Token；不主动连内网 OpenClaw |
| **OpenClaw 插件** | setup wizard 收码；POST exchange 换 token；生成并持久化 instance_id；处理 control_event | 不生成绑定码；不调用 App 端 API；不存用户密码 |

### 3.3 三个关键身份标识

```
binding_code     │ 8 字符 Base32 (excl. 0/O/1/I/L/S/2/Z) │ TTL 5 分钟 │ 一次性
                 │ 例: A3FK9PQX                          │            │ 用过即失效
─────────────────┼───────────────────────────────────────┼────────────┼──────────
instance_id      │ UUID v4，插件首次绑定时生成            │ 永久        │ 写入插件
                 │ 例: oc_550e8400-e29b-41d4-...         │            │ 配置文件
─────────────────┼───────────────────────────────────────┼────────────┼──────────
channel_token    │ 随机不透明字符串，64 字节              │ 永久但可    │ 写入插件
                 │ 例: xvc_live_aBc123...                │ rotate     │ 配置文件
```

三者的关系：

```
绑定码 ──┐ (一次性)
         ├──→  Channel Server 校验 ──→ 颁发 channel_token + 记录 binding
instance_id ┘                          (user, instance_id, token_hash)

后续 connect:
  WebSocket auth = { token: channel_token, instance_id }
  服务端两者 AND 校验，缺一不可
```

---

## 4. 数据模型

### 4.1 服务端：`binding_codes` 表（短时一次性绑定码）

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | `VARCHAR(8)` PK | Base32 大写，已去除易混字符 0/O/1/I/L/S/2/Z（剩余字符集 ≥ 24 字符 → 8 位组合数超过 1000 亿） |
| `user_id` | `VARCHAR` | 申请绑定码的 Museve 用户 |
| `created_at` | `TIMESTAMP` | 创建时间 |
| `expires_at` | `TIMESTAMP` | `created_at + 5 min` |
| `consumed_at` | `TIMESTAMP NULL` | 被 exchange 消费的时间；非 NULL 即失效 |
| `consumed_by_instance_id` | `VARCHAR NULL` | 消费该码的插件 instance_id（审计用） |
| `attempt_count` | `INT` | 校验失败次数，超过 5 次即作废（防爆破） |

### 4.2 服务端：`bindings` 表（长期绑定关系）

| 字段 | 类型 | 说明 |
|---|---|---|
| `binding_id` | `UUID` PK | 主键 |
| `user_id` | `VARCHAR` | Museve 用户 |
| `instance_id` | `VARCHAR` | 插件持久化的 UUID v4 |
| `token_hash` | `VARCHAR(64)` | `sha256(channel_token)`，明文 token 永不入库 |
| `token_prefix` | `VARCHAR(11)` | 例如 `xvc_live_aB`，便于在 App 设备列表显示前缀辨识 |
| `device_label` | `VARCHAR` | 用户自定义名称，默认 `OpenClaw on <hostname>` |
| `plugin_version` | `VARCHAR` | 首次绑定时上报，便于排查 |
| `status` | `ENUM` | `active` / `revoked` / `rotating` |
| `created_at` | `TIMESTAMP` | |
| `last_seen_at` | `TIMESTAMP` | 最近一次 WebSocket connect 成功时间 |
| `revoked_at` | `TIMESTAMP NULL` | |
| `revoked_reason` | `ENUM NULL` | `user_unbound` / `admin_revoked` / `suspicious_activity` / `user_account_deleted`（与 §7.3 `BindingRevokedPayload.reason` 一致；rotate 不进入 revoked，仅短暂 status='rotating'） |

**唯一约束**：`(user_id, instance_id) WHERE status='active'` 唯一 — 一个用户在同一 OpenClaw 实例上同时只能有一条 active binding。重复绑定走 Rotate 流程而不是新建。

### 4.3 插件本地：`MuseveVoiceConfig` 扩展

扩展现有 `src/config.ts` 的 `MuseveVoiceConfig`：

```typescript
interface MuseveVoiceConfig {
  // ─ 已有字段 ─
  enabled: boolean;
  serverUrl: string;              // WebSocket: wss://asr-test.jlpay.com/agent-channel/connect
  token: string;                  // channel_token，明文存储
  agentId: string;
  sessionPrefix: string;
  streaming: boolean;
  replyMode: "voice_first" | "text_first" | "both";
  riskPolicy: RiskPolicy;
  reconnect: ReconnectConfig;

  // ─ 新增字段 ─
  apiBaseUrl: string;             // REST: https://asr-test.jlpay.com/api/v1/agent-channel (默认值)
  instanceId: string;             // 插件自生成 UUID v4，首次绑定时写入
  deviceLabel?: string;           // 用户自定义名称，可选
  boundAt: string;                // ISO 8601 时间戳，便于诊断
  boundUserId: string;            // 仅显示用，告知用户当前绑了哪个 Museve 账号
  boundUserName?: string;         // 仅显示用，绑定时服务端返回
}
```

**关于明文 token 存储**：与现有方案一致（设计文档 §13）。OpenClaw 配置文件本身的加密属于 OpenClaw 平台层职责，不由本插件处理。

**`boundUserId` / `boundUserName` 不参与鉴权**，仅作为人眼可读的提示（用户看到"已绑定到 yangli@museve"放心）。

---

## 5. REST API 设计

所有 API：

- 走 HTTPS（强制 TLS 1.2+）
- `Content-Type: application/json`
- 错误码遵循 `application/problem+json`（RFC 7807）
- 域名假设 `https://asr-test.jlpay.com/api/v1/agent-channel`

### 5.1 `POST /api/v1/agent-channel/bindings/exchange`

插件用绑定码换长期 token。**无需鉴权**（绑定码本身就是身份证明）。

**Request**：

```http
POST /api/v1/agent-channel/bindings/exchange HTTP/1.1
Content-Type: application/json
X-Plugin-Version: 0.1.0
X-Idempotency-Key: <uuid>

{
  "code": "A3FK9PQX",
  "instance_id": "oc_550e8400-e29b-41d4-a716-446655440000",
  "device_label": "OpenClaw on yangli-mac",
  "plugin_version": "0.1.0"
}
```

**Response 200**：

```json
{
  "channel_token": "xvc_live_aBcD...64字节...",
  "token_prefix": "xvc_live_aB",
  "binding_id": "b_7f3e...",
  "user_id": "museve_user_123",
  "user_display_name": "杨立",
  "ws_url": "wss://asr-test.jlpay.com/agent-channel/connect"
}
```

**Response 4xx / 410**：

| HTTP | error.type | 含义 |
|---|---|---|
| 400 | `invalid_code_format` | 码格式不对（长度/字符集） |
| 401 | `code_not_found` | 码不存在 |
| 401 | `code_attempts_exceeded` | 校验失败 ≥5 次，码已锁定 |
| 410 | `code_expired` | 码已过期 |
| 410 | `code_consumed` | 码已被使用过 |
| 409 | `instance_already_bound` | 同 user + instance 已存在 active binding |
| 429 | `rate_limited` | 触发限流（含 `Retry-After` header） |

### 5.2 `POST /api/v1/agent-channel/bindings/rotate`

插件主动 Rotate（响应 App 推送的 `token_rotated_notify` 控制事件，或用户在 setup wizard 触发）。

**Request**：

```http
POST /api/v1/agent-channel/bindings/rotate HTTP/1.1
Authorization: Bearer <old_channel_token>
X-Instance-Id: oc_550e8400-...
Content-Type: application/json

{}
```

**Response 200**：

```json
{
  "channel_token": "xvc_live_xYz...(新)",
  "token_prefix": "xvc_live_xY",
  "rotated_at": "2026-05-15T10:23:00Z"
}
```

旧 token 在响应发出后 **60 秒缓冲期**内仍可用（避免插件还没写盘就被踢），之后服务端单方面失效。

### 5.3 `DELETE /api/v1/agent-channel/bindings/me`

插件主动解绑（用户在 OpenClaw setup wizard 选"解绑"）。

**Request**：

```http
DELETE /api/v1/agent-channel/bindings/me HTTP/1.1
Authorization: Bearer <channel_token>
X-Instance-Id: oc_550e8400-...
```

**Response 204** No Content。插件随即清空本地 config 的 token / instanceId / boundAt / boundUserId 字段。

### 5.4 App 侧 API（不在插件 scope，需对齐）

仅列出与插件强相关的，确保协议自洽：

| 方法 + 路径 | 用途 | 谁调用 |
|---|---|---|
| `POST /v1/app/bindings/codes` | App 请求生成绑定码（带用户 session） | App |
| `GET  /v1/app/bindings` | App 拉用户的设备列表 | App |
| `DELETE /v1/app/bindings/:binding_id` | App 端解绑某个 OpenClaw | App |
| `POST /v1/app/bindings/:binding_id/rotate` | App 强制踢 token | App |

App 侧 `DELETE` / `rotate` 操作后，服务端需要：

1. 修改 `bindings.status` 为 `revoked` / `rotating`
2. 通过当前在线连接的 WebSocket 推 `control_event` 给该插件（详见 §7）
3. 推送后主动 close WebSocket

---

## 6. 端到端时序图

### 6.1 时序 A：首次绑定（Happy Path）

```
User              Museve App         Channel Server         OpenClaw Plugin
 │                    │                    │                    │
 │ 点"连接OpenClaw"   │                    │                    │
 ├───────────────────>│                    │                    │
 │                    │ POST /v1/app/      │                    │
 │                    │ bindings/codes     │                    │
 │                    ├───────────────────>│                    │
 │                    │                    │ 1. 生成 8 位码     │
 │                    │                    │ 2. 写 binding_codes│
 │                    │                    │    TTL=5min        │
 │                    │  200 {code,        │                    │
 │                    │       expires_at}  │                    │
 │                    │<───────────────────┤                    │
 │  显示 A3FK9PQX     │                    │                    │
 │  倒计时 5:00       │                    │                    │
 │<───────────────────┤                    │                    │
 │                                         │                    │
 │  (用户切到 OpenClaw 终端，执行 setup wizard)                  │
 │  openclaw plugins setup museve-voice                          │
 ├──────────────────────────────────────────────────────────────>│
 │                                         │                    │ a. 检测 instanceId
 │                                         │                    │    不存在
 │                                         │                    │ b. 生成 UUID v4
 │                                         │                    │ c. prompt "输入绑定码"
 │  输入 "A3FK9PQX"                                              │
 ├──────────────────────────────────────────────────────────────>│
 │                                         │ POST /api/v1/agent-channel/ │
 │                                         │ bindings/exchange  │
 │                                         │ {code, instance_id,│
 │                                         │  device_label, ver}│
 │                                         │<───────────────────┤
 │                                         │                    │
 │                                         │ 1. 查 code, 校验:  │
 │                                         │    - 存在?         │
 │                                         │    - 未过期?       │
 │                                         │    - 未consumed?   │
 │                                         │    - 失败次数<5?   │
 │                                         │ 2. 生成 token      │
 │                                         │ 3. 写 bindings 表  │
 │                                         │ 4. 标 code已消费   │
 │                                         │ 200 {channel_token,│
 │                                         │  binding_id, ws_url│
 │                                         │  user_id, name}    │
 │                                         ├───────────────────>│
 │                                         │                    │ d. 持久化到 config:
 │                                         │                    │    token,instanceId,
 │                                         │                    │    boundAt,boundUserId
 │                                         │                    │
 │                                         │                    │ e. 尝试 WebSocket 连接
 │                                         │ ws/connect         │
 │                                         │ {token,instance_id}│
 │                                         │<───────────────────┤
 │                                         │ 双因子校验通过      │
 │                                         │ connected event    │
 │                                         ├───────────────────>│
 │                                         │                    │
 │                    │ device_bound event  │                    │
 │                    │<───────────────────┤                    │
 │  显示"OpenClaw 已绑定"  ✓               │  打印"✓ 绑定成功"  │
 │<───────────────────┤                    │<───────────────────┤
```

**关键点**：

1. `instance_id` 在 OpenClaw 这边惰性生成（步骤 b）—— 仅在首次绑定时创建；后续 setup wizard 重新运行不会重复生成（除非配置被清掉）
2. `exchange` 是原子操作：标记 code 已消费 + 创建 binding 必须在同一事务中
3. 绑定成功后立即尝试 WS 连接，提前暴露任何网络问题
4. App 端的"已绑定"通知走 App 的长连接，不在本插件 scope 内

### 6.2 时序 B：用户在 App 解绑

```
User              Museve App         Channel Server         OpenClaw Plugin
 │                    │                    │  (运行中, WS 在线) │
 │                    │                    │<══════════════════>│
 │ 设备列表→点解绑    │                    │                    │
 ├───────────────────>│                    │                    │
 │  确认               │ DELETE /v1/app/    │                    │
 ├───────────────────>│ bindings/{id}      │                    │
 │                    ├───────────────────>│                    │
 │                    │                    │ 1. UPDATE bindings │
 │                    │                    │    status=revoked  │
 │                    │                    │    revoked_at=now  │
 │                    │  204 No Content     │                    │
 │                    │<───────────────────┤                    │
 │  "已解绑"           │                    │                    │
 │<───────────────────┤                    │                    │
 │                    │                    │                    │
 │                    │                    │ 2. 查找该 binding   │
 │                    │                    │    的 online conn   │
 │                    │                    │ 3. 推 control_event:│
 │                    │                    │   binding_revoked   │
 │                    │                    ├═══════════════════>│
 │                    │                    │ 4. WS close 1000   │
 │                    │                    ├═══════════════════>│
 │                    │                    │                    │ a. 收到 binding_revoked
 │                    │                    │                    │    → 不重连
 │                    │                    │                    │ b. 清本地 config
 │                    │                    │                    │ c. 日志: "Unbound by 
 │                    │                    │                    │    user via App"
 │                    │                    │                    │ d. 状态变为 idle
```

**关键点**：

1. 服务端先改状态再通知，避免 race condition
2. control_event 推送和 WS close 是同一动作；close reason 里也带 `binding_revoked`，双重保险
3. `reason='user_unbound'` 让插件知道是被用户主动解绑，与 token 失效/管理员撤销区分
4. 插件 b 步骤要彻底清理本地状态，特别是 `instance_id` 也要清——下次绑定生成新的 UUID，旧的 instance_id 永久作废

**离线场景**：如果解绑时插件正好不在线，control_event 无法投递。处理方式：

- 服务端把 `revoked` 状态写到 binding 表
- 插件下次 connect 时，服务端发现 binding 已 revoked，立即在 connect 握手里返回 `auth_failed: binding_revoked` 错误并 close
- 插件收到该错误后执行同样的 a-d 清理动作

### 6.3 时序 C：Rotate Token

```
User              Museve App         Channel Server         OpenClaw Plugin
 │ 设备详情→Rotate    │  (WS 在线)         │                    │
 ├───────────────────>│                    │<══════════════════>│
 │                    │ POST /v1/app/      │                    │
 │                    │ bindings/{id}/     │                    │
 │                    │ rotate             │                    │
 │                    ├───────────────────>│                    │
 │                    │                    │ 1. UPDATE bindings │
 │                    │                    │    status='rotating'│
 │                    │  200 {request_id}   │                    │
 │                    │<───────────────────┤                    │
 │                    │                    │ 2. 推 control_event:│
 │                    │                    │   token_rotated_    │
 │                    │                    │   notify            │
 │                    │                    ├═══════════════════>│
 │                    │                    │                    │ a. 收到 notify
 │                    │                    │ POST /api/v1/agent-channel/ │ b. 用旧 token 调:
 │                    │                    │ bindings/rotate    │
 │                    │                    │ Bearer <old_token> │
 │                    │                    │ X-Instance-Id: oc..│
 │                    │                    │<───────────────────┤
 │                    │                    │ 3. 校验旧 token + │
 │                    │                    │    instance_id     │
 │                    │                    │ 4. 生成新 token    │
 │                    │                    │ 5. UPDATE bindings │
 │                    │                    │    token_hash=新   │
 │                    │                    │    status='active' │
 │                    │                    │    保留旧 token 60s│
 │                    │                    │ 200 {channel_token,│
 │                    │                    │  rotated_at}        │
 │                    │                    ├───────────────────>│
 │                    │                    │                    │ c. 持久化新 token
 │                    │                    │                    │ d. WebSocket 不断
 │                    │                    │                    │ e. 下次重连用新 token
 │                    │  rotate_done event  │                    │
 │                    │<═══════════════════┤                    │
 │  "Token 已更新"     │                    │                    │
 │<───────────────────┤                    │                    │
```

**关键点**：

1. App 主动发起，插件被动响应：因为只有插件持有 OpenClaw 的本地写盘权限，新 token 必须由插件自己拉
2. 60 秒缓冲期是关键：避免插件还没把新 token 写盘就被旧 token 踢下线，导致绑定失效
3. WebSocket 连接不断：现有 WS 用的还是旧 token，缓冲期内不影响
4. 如果插件离线：服务端把状态停在 `rotating`，TTL 10 分钟，超时回滚为 `active`（不 rotate 也无害，重试一次即可）

### 6.4 时序 D：服务端单方面拒绝

```
OpenClaw Plugin                         Channel Server
       │                                       │
       │ 启动 / 重连                            │
       │ WebSocket connect                      │
       ├──────────────────────────────────────>│
       │ {auth: {token, instance_id}}           │
       │                                       │ 1. 查 bindings 表
       │                                       │ 2. token_hash 匹配?
       │                                       │ 3. status == 'active'?
       │                                       │ 4. instance_id 匹配?
       │  ws send: error event                  │ → 任何一项失败
       │  {type: 'error',                       │
       │   error: 'auth_failed',                │
       │   reason: 'binding_revoked' |          │
       │           'token_invalid' |            │
       │           'instance_mismatch'}         │
       │<──────────────────────────────────────┤
       │  ws close 1008 Policy Violation        │
       │<══════════════════════════════════════┤
       │                                       │
       │ 处理逻辑（按 reason 分支）：           │
       │  ─ binding_revoked / token_invalid:   │
       │      清本地 config，停止重连           │
       │  ─ instance_mismatch:                 │
       │      ★告警★：token 可能被拷贝         │
       │      清本地 config，建议 App rotate    │
```

**关键点**：

1. `instance_mismatch` 比 `token_invalid` 更严重：意味着 token 可能已经被拷贝到攻击者机器，需要主动告警而不是静默清理
2. 重连策略要按 reason 分支：通用网络错误正常退避重连；鉴权错误一律停止重连，避免无意义的爆破式重连刷爆服务端
3. 错误信息要尽可能明确：服务端不应该笼统返回 `auth_failed`，而要分 `binding_revoked` / `token_invalid` / `instance_mismatch`

---

## 7. 控制事件协议（control_event）

### 7.1 设计原则

1. **不破坏现有协议**：复用 XVC envelope（`event_id` / `type` / `created_at` / `payload`），现有 `client.ts` 的事件分发器只需新增一个 case
2. **单向推送**：所有 `control_event` 都是服务端→插件，插件不主动发起
3. **幂等可重放**：每个事件带 `event_id`，插件需做去重；服务端重复推送同一事件不应导致重复副作用
4. **副作用前置**：服务端先持久化状态变更，再推事件

### 7.2 事件类型清单

| `type` | 触发场景 | 插件应做什么 | MVP |
|---|---|---|---|
| `binding_revoked` | 用户解绑 / 管理员风控 / 可疑活动 | 清本地 config，停止重连，告知用户 | 必须 |
| `token_rotated_notify` | 用户触发 rotate | 立即调 REST `/rotate` 拉新 token，写盘，保持 WS | 必须 |
| `binding_metadata_updated` | 改 device_label 等元信息 | 拉新元数据回写 config | 可选 |
| `server_announcement` | 协议升级、维护窗口 | 日志记录，可选播报 | 可选 |

### 7.3 事件 Schema

```typescript
// 7.3.1 binding_revoked
interface BindingRevokedPayload {
  binding_id: string;
  reason:
    | "user_unbound"
    | "admin_revoked"
    | "suspicious_activity"
    | "user_account_deleted";
  revoked_at: string;
  message?: string;
}

// 7.3.2 token_rotated_notify
interface TokenRotatedNotifyPayload {
  binding_id: string;
  request_id: string;
  initiated_by: "user" | "system";
  grace_period_sec: number;
}

// 7.3.3 binding_metadata_updated
interface BindingMetadataUpdatedPayload {
  binding_id: string;
  changes: {
    device_label?: string;
  };
}

// 7.3.4 server_announcement
interface ServerAnnouncementPayload {
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  action_url?: string;
  expires_at?: string;
}
```

### 7.4 与现有 XVC 协议的关系

```
                    ┌─ 运行时事件（已有）──────────────────┐
                    │ inbound_message                       │
                    │ outbound_message / outbound_delta     │
                    │ confirmation_request/response         │
                    │ voice_interrupt                       │
                    │ delivery_ack                          │
                    │ task_started / task_done              │
                    └───────────────────────────────────────┘
XVC Event ──┬──────►
            │       ┌─ 连接控制事件（已有）─────────────────┐
            │       │ connect / connected                   │
            │       │ ping / pong                           │
            │       │ resume                                │
            │       │ error                                 │
            │       └───────────────────────────────────────┘
            │
            └────►  ┌─ 绑定控制事件（本次新增）★★★★★ ──┐
                    │ binding_revoked                       │
                    │ token_rotated_notify                  │
                    │ binding_metadata_updated              │
                    │ server_announcement                   │
                    └───────────────────────────────────────┘
```

### 7.5 控制事件的特殊性

- **优先级最高**：可能正在跑着 `inbound_message` 处理，但 `binding_revoked` 一到就要立即响应
- **不进入 session**：不像 `inbound_message` 那样路由到某个 chat_id；它是连接维度的事件
- **不需要 ack**：服务端不期待插件回 ack，因为 close 紧接而至

### 7.6 处理逻辑（伪代码）

```typescript
// src/control-events.ts
export async function handleBindingRevoked(
  payload: BindingRevokedPayload,
  ctx: { bindingStore, client, log }
) {
  ctx.log.warn(`Binding revoked: ${payload.reason}`, payload);

  // 1. 停止重连
  ctx.client.disableReconnect();

  // 2. 彻底清空本地绑定
  await ctx.bindingStore.clear();

  // 3. 发出插件级事件
  ctx.client.events.onBindingLost?.(payload.reason);

  // 4. 服务端会紧接着 close；这里不主动 close，避免双向 close 竞态
}

export async function handleTokenRotatedNotify(
  payload: TokenRotatedNotifyPayload,
  ctx: { bindingStore, restClient, log }
) {
  const { token: oldToken, instanceId } = await ctx.bindingStore.read();

  try {
    const { channel_token: newToken } = await ctx.restClient.rotate(
      oldToken, instanceId
    );
    await ctx.bindingStore.updateToken(newToken);
    ctx.log.info(`Token rotated successfully`);
  } catch (err) {
    // 留旧 token；服务端 60s 后会单方面失效
    ctx.log.error(`Token rotate failed: ${err.message}`);
  }
}
```

### 7.7 边界情况

| 场景 | 处理 |
|---|---|
| 插件离线期间发生 revoke | control_event 投递不到；插件下次 connect 时服务端在 `connect` 响应里返回 `error: binding_revoked`，效果等同 |
| `token_rotated_notify` 推过来但 rotate 失败 | 服务端 60 秒后单方面失效旧 token；插件下次连接拿到 `token_invalid` 走重新绑定流程 |
| 同一 `event_id` 被重复推送（网络重试） | 用最近 100 个 `event_id` 的 LRU 去重 |
| 收到未知 `type` 的 control_event | warn 日志，跳过，不中断连接（向前兼容） |

---

## 8. 错误处理矩阵

### 8.1 绑定阶段（REST `/bindings/exchange`）

| HTTP | error.type | 服务端原因 | 插件应对 | 用户感知 |
|---|---|---|---|---|
| 400 | `invalid_code_format` | 码长度/字符集不对 | prompt 重新输入 | "格式不对，请重输（8 位字母数字）" |
| 401 | `code_not_found` | 码不存在 | prompt 重新输入，attempt_count++ | "绑定码无效" |
| 401 | `code_attempts_exceeded` | 累计 5 次失败 | 终止，建议重新生成码 | "尝试过多，请在 App 重新生成" |
| 410 | `code_expired` | 超过 5 分钟 | 终止，建议重新生成码 | "绑定码已过期（5 分钟），请重新生成" |
| 410 | `code_consumed` | 已被消费 | 终止，建议重新生成码 | "该码已被使用过" |
| 409 | `instance_already_bound` | 同 user + instance 已存在 active binding | 提示是否覆盖（rotate） | "该 OpenClaw 已绑定到此账号，是否更新 token？" |
| 429 | `rate_limited` | 触发限流 | 等待 `Retry-After` 秒 | "请求过快，请稍后重试" |
| 5xx | `server_error` | 服务端故障 | 退避重试 (1s→2s→4s, max 3 次) | "服务暂时不可用" |

### 8.2 运行时鉴权（WebSocket `connect`）

| 错误 reason | 触发条件 | 插件应对 |
|---|---|---|
| `binding_revoked` | `binding.status != 'active'` | 清本地 config，停止重连 |
| `token_invalid` | token_hash 不匹配 | 清本地 config，停止重连 |
| `instance_mismatch` | token 有效但 instance_id 不匹配 | ★告警★：可能 token 被拷贝，清并建议 App rotate |
| `version_unsupported` | protocol_version 不在服务端支持列表 | 停止重连，提示用户升级插件 |

### 8.3 控制事件处理

| 场景 | 处理 |
|---|---|
| `binding_revoked` 收到但本地 config 已为空 | 幂等：直接 ack 服务端 close，无副作用 |
| `token_rotated_notify` 但 rotate REST 失败 | 留旧 token；服务端 60s 后单方面失效；下次连接走重新绑定 |
| 收到未知 `type` 的 control_event | warn 日志，跳过，不中断 |
| `event_id` 重复 | LRU 去重 |

### 8.4 持久化

| 场景 | 处理 |
|---|---|
| 写 config 文件失败（磁盘满 / 权限） | exchange 不完成（不 ACK 服务端），用户重试 |
| config 文件损坏 / 缺字段 | 当 idle 状态处理，提示重新 setup |
| 多进程同时启动同一插件实例 | 用 file lock 保证只有一个进程持有 binding |

---

## 9. 安全设计

### 9.1 绑定码爆破防护

8 位 Base32（去除易混字符后 ≥24 字符）超过 1000 亿种组合，理论命中概率极低。但仍需多层防护避免**针对单个有效码窗口的爆破**：

| 防护层 | 措施 |
|---|---|
| **单码失败上限** | 同一 `code` 累计校验失败 ≥5 次即作废 |
| **IP 限流** | 同一 IP 每分钟 ≤10 次 `/exchange` 请求 |
| **全局限流** | 服务端整体 `/exchange` QPS 限制 + 异常监控告警 |
| **短 TTL** | 5 分钟过期，缩小爆破窗口 |
| **常时比较** | 服务端 code 校验用 `crypto.timingSafeEqual` 防时序攻击 |

数学上：5 分钟窗口 + IP 限流 10 QPS → 同一 IP 最多 3000 次尝试，对 1000 亿空间命中概率约 3×10⁻⁸。如果攻击者用 1000 个 IP 协同，全局限流（如 100 QPS）会触发告警。

### 9.2 Token 存储

**服务端**：

- `bindings.token_hash = sha256(channel_token)`，明文 token 永不入库
- 生成 token 用 `crypto.randomBytes(48)` → base64url，约 64 字节
- token 前缀 `xvc_live_` 是公开的，仅最后 56 字节是密文部分
- 日志里 token 只打印前 8 位（前缀），其余 mask 为 `****`
- DB 备份要 at-rest 加密

**插件本地**（OpenClaw config 文件）：

- 明文存储（与现有方案一致）
- 依赖 OpenClaw 平台层的配置文件安全（权限位 600，OpenClaw 用户独占）
- 如果 OpenClaw 后续支持 secret 字段加密，应迁移到该机制
- 不进 git

### 9.3 传输加密

| 通道 | 协议 | 备注 |
|---|---|---|
| 插件 → REST | HTTPS only | 拒绝 HTTP 重定向到 HTTPS |
| 插件 → WebSocket | WSS only | `config.serverUrl` 必须以 `wss://` 开头 |
| App → REST | HTTPS only | 不在插件 scope，需对齐 |
| TLS 版本 | TLS 1.2+ | 拒绝 TLS 1.0/1.1 |
| 证书 | 公认 CA 签发 | 不接受自签名（开发环境需 explicit opt-in 配置项 `allowInsecureTls`） |

### 9.4 审计日志

服务端必须记录的事件（保留 ≥90 天）：

| 事件 | 关键字段 |
|---|---|
| `binding.code_issued` | user_id, code_id, ip, ua |
| `binding.code_exchanged` | user_id, binding_id, instance_id, ip, ua, plugin_version |
| `binding.code_failed` | code_id, attempt_count, ip, ua, reason |
| `binding.revoked` | binding_id, reason, actor |
| `binding.rotated` | binding_id, request_id, initiated_by |
| `binding.connect_rejected` | binding_id, reason, ip |

**`instance_mismatch` 必须告警**：单 binding 在 24 小时内出现 ≥3 次 instance_mismatch → 自动 `binding.status = revoked, revoked_reason = suspicious_activity` + 推 App 通知。

插件侧日志要求：

- 不打印 token 明文（即使 DEBUG 级别）
- 不打印绑定码明文
- 打印 `instance_id` 允许（不算敏感）

### 9.5 速率限制

| 接口 | 限制 | 维度 |
|---|---|---|
| `POST /bindings/exchange` | 10/min | per IP |
| `POST /bindings/exchange` | 5/min | per code |
| `POST /bindings/rotate` | 6/hour | per binding_id |
| `DELETE /bindings/me` | 10/hour | per binding_id |
| App `POST /bindings/codes` | 10/hour | per user_id |
| WebSocket connect | 30/min | per IP |

超限返回 `429 Too Many Requests`，`Retry-After` header 给出秒数。

### 9.6 防误绑定到错账号

风险：用户在 App 生成码后没及时绑，码失效；另一个用户碰巧生成了码，OpenClaw 这边输错码。

防护：

1. `exchange` 响应里返回 `user_display_name`，插件 setup wizard **必须**展示并要求用户确认 `Yes/No`
2. App 端 push 通知："您的 OpenClaw 已绑定到 `OpenClaw on yangli-mac`，如非本人操作请立即解绑"
3. 24 小时反悔窗口：新绑定后 24 小时内，App 端解绑无需二次确认

### 9.7 可观测性

服务端关键指标：

- `binding.exchange.success` / `binding.exchange.failure` 计数（按 reason 分桶）
- `binding.exchange.duration_ms` p50/p95/p99
- `binding.online_connections` gauge
- `binding.connect_rejected_rate`（>5% 告警）
- `binding.instance_mismatch_count` per binding（突增告警）

---

## 10. setup-entry 改造点

### 10.1 文件改动总表

| 文件 | 状态 | 行数估算 | 责任 |
|---|---|---|---|
| `src/binding-store.ts` | ★新增 | ~80 | 本地绑定持久化的抽象层 |
| `src/rest-client.ts` | ★新增 | ~150 | REST API 客户端（exchange / rotate / unbind） |
| `src/control-events.ts` | ★新增 | ~100 | 四种 control_event 的处理逻辑 |
| `setup-entry.ts` | ✎ 重写 | ~150（覆盖现有 ~100） | 改为"绑定码→exchange→写盘"流程 |
| `src/config.ts` | ✎ 改 | +30 | 新增字段 |
| `src/protocol.ts` | ✎ 改 | +60 | 新增 4 个 control_event 类型 |
| `src/client.ts` | ✎ 改 | +40 / -10 | instance_id 从 binding-store 读；新增 dispatch 分支 |
| `src/channel.ts` | ✎ 改 | +20 | 暴露 `onBindingLost` 事件钩子 |
| `test/unit/binding-store.test.ts` | ★新增 | ~120 | 读/写/清/损坏 config 容错 |
| `test/unit/rest-client.test.ts` | ★新增 | ~150 | 各种 HTTP 状态码、错误映射、重试 |
| `test/unit/control-events.test.ts` | ★新增 | ~150 | 四种事件的处理路径，含幂等去重 |
| `test/unit/setup-entry.test.ts` | ★新增 | ~120 | prompt 流程、错误码映射、用户确认 |
| `test/integration/binding.test.ts` | ★新增 | ~200 | 端到端：绑定→connect→运行→解绑 |

**总计**：新增 3 个 src 模块 + 5 个 test 文件，改动 5 个现有文件。代码量约 1200 行。

### 10.2 关键模块接口

#### `src/binding-store.ts`

```typescript
import { createLogger } from "./logger.js";

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

export function createBindingStore(opts: {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
}): BindingStore;
```

要点：

- 不直接依赖 OpenClaw 平台 API，注入 `read/write` 回调，便于单元测试
- `write()` 内部保证多字段同时落盘，避免半成品状态

#### `src/rest-client.ts`

```typescript
import { createLogger } from "./logger.js";

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
  | "server_error";

export class ExchangeError extends Error {
  constructor(
    public type: ExchangeErrorType,
    public retryAfterSec?: number
  ) {
    super(type);
  }
}

export interface RestClient {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
  rotate(oldToken: string, instanceId: string): Promise<{ channelToken: string }>;
  unbind(token: string, instanceId: string): Promise<void>;
}

export function createRestClient(apiBaseUrl: string): RestClient;
```

要点：

- typed exception，调用方按 `err.type` 分支决定 UI 提示
- 5xx 错误内部退避重试 3 次（1s→2s→4s），4xx 直接抛
- 默认超时 10s

### 10.3 改造后的 `setup-entry.ts`（伪代码）

```typescript
import crypto from "node:crypto";
import os from "node:os";
import { createBindingStore } from "./src/binding-store.js";
import { createRestClient, ExchangeError } from "./src/rest-client.js";
import { createLogger } from "./src/logger.js";

const PLUGIN_VERSION = "0.1.0";

export default async function setup(context: SetupContext): Promise<void> {
  const log = context.log;
  log("Museve Voice Channel 配置向导");
  log("────────────────────────────");

  // 1. 检测当前是否已绑定
  const store = createBindingStore(context);
  const existing = await store.read();

  if (existing) {
    log(`当前已绑定到: ${existing.boundUserName} (${existing.boundUserId})`);
    log(`Instance ID: ${existing.instanceId}`);
    log(`绑定时间: ${existing.boundAt}`);
    const action = await context.prompt(
      "选择操作: [1] 保持现状  [2] 重新绑定  [3] 解绑"
    );
    if (action === "1") return;
    if (action === "3") return await handleUnbind(existing, context);
  }

  // 2. 读取/生成 instance_id
  let instanceId = existing?.instanceId;
  if (!instanceId) {
    instanceId = `oc_${crypto.randomUUID()}`;
    log(`生成新设备 ID: ${instanceId.slice(0, 16)}...`);
  }

  // 3. prompt 绑定码
  log("请在 Museve App 中点击「连接 OpenClaw」获取绑定码。");
  const code = await promptCode(context);
  if (!code) return;

  // 4. 调 exchange
  const apiBaseUrl = await promptApiBaseUrl(context);
  const client = createRestClient(apiBaseUrl);
  log("正在验证绑定码...");

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
      log(`✗ ${ERROR_MESSAGES[err.type]}`);
      if (err.retryAfterSec) log(`  请 ${err.retryAfterSec} 秒后重试`);
    } else {
      log(`✗ 网络错误: ${(err as Error).message}`);
    }
    return;
  }

  // 5. 用户身份二次确认
  log(`即将绑定到: ${resp.userDisplayName} (${resp.userId})`);
  const confirm = await context.prompt("确认绑定吗？[y/N]");
  if (confirm.toLowerCase() !== "y") {
    log("已取消绑定。");
    await client.unbind(resp.channelToken, instanceId);
    return;
  }

  // 6. 写盘
  await store.write({
    token: resp.channelToken,
    instanceId,
    boundAt: new Date().toISOString(),
    boundUserId: resp.userId,
    boundUserName: resp.userDisplayName,
  });

  // 7. 立即尝试 WebSocket 连接验证
  log("正在建立 WebSocket 连接...");
  const verifyResult = await verifyWsConnection(resp.wsUrl, resp.channelToken, instanceId);

  if (verifyResult.success) {
    log("✓ 绑定成功，WebSocket 连接已建立。");
  } else {
    log(`⚠ 绑定已保存，但 WebSocket 连接失败: ${verifyResult.error}`);
    log("  插件运行时会自动重试连接。");
  }
}
```

### 10.4 改造后的 `src/client.ts` 关键改动

```typescript
import { BindingStore } from "./binding-store.js";

// 改动 1: instanceId 从 binding-store 读，不再 fake
constructor(
  config: MuseveVoiceConfig,
  events: ClientEvents,
  bindingStore: BindingStore   // ★新增依赖
) {
  // ... 现有逻辑
  // this.instanceId = `oc_${Date.now().toString(36)}`;  ← 删除
}

async connect(): Promise<void> {
  const binding = await this.bindingStore.read();
  if (!binding) {
    log.warn("No binding found, skipping connect");
    this.events.onBindingMissing?.();
    return;
  }
  this.instanceId = binding.instanceId;
  this.token = binding.token;
  // ... 后续 WS 建立逻辑
}

// 改动 2: dispatch 新增 control_event 分支
private handleMessage(data: string): void {
  const event = parseEvent(data);
  if (!event) return;

  switch (event.type) {
    case "connected":
    case "ping":
    case "pong":
    case "inbound_message":
    case "outbound_delta":
    // ... 现有事件
      break;

    // ★ 新增：control_event 分支
    case "binding_revoked":
      this.controlEvents.handleBindingRevoked(event.payload);
      break;
    case "token_rotated_notify":
      this.controlEvents.handleTokenRotatedNotify(event.payload);
      break;
    case "binding_metadata_updated":
      this.controlEvents.handleMetadataUpdated(event.payload);
      break;
    case "server_announcement":
      this.controlEvents.handleAnnouncement(event.payload);
      break;
  }
}
```

---

## 11. 测试策略

### 11.1 单元测试（vitest）

| 文件 | 关键测试用例 |
|---|---|
| `binding-store.test.ts` | 空状态返回 null；write 后 read 完整回读；部分字段缺失 → 视为未绑定；updateToken 不影响其他字段；clear 后 isBound 返回 false |
| `rest-client.test.ts` | 200 → 正确解析；401 code_expired → ExchangeError；429 → 含 retryAfterSec；5xx 重试 3 次后抛出；网络错误 → ExchangeError(network_error) |
| `control-events.test.ts` | binding_revoked → store.clear + disableReconnect 被调用；token_rotated_notify → 调 rest.rotate 并 updateToken；重复 event_id 只处理一次；rotate 失败留旧 token |
| `setup-entry.test.ts` | 输入有效码 → 调 exchange → 写盘；用户拒绝二次确认 → 调 unbind 回滚；已绑定时显示当前状态；各种 ExchangeError 映射到正确提示文案 |

### 11.2 集成测试

`test/integration/binding.test.ts` 扩展现有 `mock-server.ts`，端到端测试：

1. mock server 准备一个有效 code
2. 模拟 setup wizard 走完整流程
3. 验证 binding-store 已写入
4. 启动 client，验证 WS 连接成功
5. mock server 推 `binding_revoked`
6. 验证插件自动清理（store 已清空、client 已断开）

---

## 12. 实施分阶段

| 阶段 | 范围 | 估时 |
|---|---|---|
| **P1: 基础绑定（必须）** | binding-store + rest-client + setup-entry 重写 + config 扩展 + 单元测试 | 3-5 天 |
| **P2: 控制事件（必须）** | control-events + protocol 扩展 + client dispatch + 单元测试 | 2-3 天 |
| **P3: 鉴权增强（必须）** | client.connect 双因子鉴权 + 错误分支处理 + 集成测试 | 2-3 天 |
| **P4: 体验补全（建议）** | rotate 流程 + 重新绑定 UX + binding_metadata_updated + server_announcement | 2-3 天 |
| **P5: 安全加固（建议）** | 速率限制对接 + 审计日志规范 + instance_mismatch 告警逻辑 | 1-2 天 |

P1-P3 完成即可上线 MVP；P4-P5 可以并行迭代。

---

## 13. 兼容性考虑

| 风险点 | 说明 | 缓解 |
|---|---|---|
| `setup-entry.ts` 的 `verifyToken` 函数被外部依赖 | 当前是 export，可能有人调 | 保留兼容签名，标记 `@deprecated`，内部委托给新流程 |
| 现有 `config.token` 字段已存在用户配置 | 老用户的 token 是手动粘贴的，没有 `instanceId` | 启动时检测：有 token 但无 instanceId → 视为 legacy 模式，提示用户重新绑定 |
| OpenClaw 平台的 `setup-entry` 接口 | 当前签名 `(context: { prompt, writeConfig, log }) => Promise<void>` | 新版需要 `readConfig` 能力（检测已有绑定），需在 `src/types/openclaw.d.ts` 扩展接口 |

---

## 14. 开放问题与后续工作

| 项 | 说明 | 谁负责 |
|---|---|---|
| OpenClaw 平台的 `setup-entry` 接口是否能扩展 `readConfig` | 需要与 OpenClaw 团队确认 | 设计阶段 |
| App 端的 Push 通知通道是否已就绪 | "已绑定" / "instance_mismatch 告警" 都依赖此 | App 团队 |
| `binding_metadata_updated` / `server_announcement` 的 UI 表现 | 是否需要弹窗 / 状态栏？ | 后续 P4 阶段 |
| 多 OpenClaw 实例间的路由 | App 用户同时绑多台时，发到哪一台？ | 后续设计文档 |
| 离线时的 binding 状态查询 | 是否需要插件定期 HTTP 拉一次 `/bindings/me/status` 兜底？ | 视监控数据再定 |

---

## 附录 A：与现有设计文档的关系

本文档是 `2026-05-14-museve-voice-channel-design.md` 的补充，专注于**绑定流程**这一原文档简略带过的部分。两份文档的关系：

| 维度 | 2026-05-14 文档 | 本文档（2026-05-15） |
|---|---|---|
| 范围 | XVC 协议、Channel Plugin 全貌、消息收发 | 绑定生命周期（首次绑定/解绑/Rotate） |
| 实施阶段 | Phase 1-3（基础/增强/全双工） | P1-P5（基础绑定/控制事件/鉴权/补全/加固） |
| 依赖关系 | 本文档依赖前文 | — |

如有冲突，以本文档（更晚日期）为准。

---

## 附录 B：术语表

| 术语 | 全称 | 含义 |
|---|---|---|
| XVC | Museve Voice Channel Protocol | 现有的语音通道协议 |
| binding_code | — | 8 位一次性绑定码 |
| channel_token | — | 长期 Channel Token，绑定 instance_id |
| instance_id | — | OpenClaw 插件实例 UUID v4，持久化 |
| binding | — | (user_id, instance_id, token_hash) 三元组 |
| control_event | — | 服务端推送给插件的绑定生命周期事件 |
| Rotate | — | 主动更换 Token（旧 Token 60s 后失效） |
| R3 操作 | — | 高风险操作（删除/支付/公开发布），不允许纯语音确认 |
