# Xalgo Voice OpenClaw Channel Plugin 设计文档

版本：v1.0  
日期：2026-05-14  
方案选型：方案 C（混合模式——标准 Channel Plugin + 扩展协议层）

---

## 1. 概述

`@xalgo/voice-openclaw-plugin` 是一个 OpenClaw Channel 插件，让用户通过 Xalgo 眼镜语音实时控制自己的 OpenClaw Agent。

核心定位：把 Xalgo 的语音通道接入 OpenClaw 的消息系统，不做 AI Agent 本体，不做 ASR/TTS/AEC。

---

## 2. 架构选型

采用**混合模式**：以 OpenClaw 标准 Channel Plugin 接口（类飞书 Channel）为骨架，增加 Protocol 层处理 XVC 协议特有事件。

三层分离：

- **Channel Layer** — 注册到 OpenClaw，处理标准 InboundMessage / DeliveryResult
- **Protocol Layer** — 处理 XVC 协议事件分发、确认流程、打断逻辑、流式 delta
- **Transport Layer** — 管理 WebSocket 连接生命周期（connect/auth/ping/reconnect/resume）

```
OpenClaw Instance
└── @xalgo/voice-openclaw-plugin
    ├── Channel Layer (api.registerChannel)
    │   ├── inbound adapter
    │   └── outbound adapter
    ├── Protocol Layer (XVC)
    │   ├── event dispatch
    │   ├── confirmation
    │   ├── interrupt
    │   ├── streaming delta
    │   └── delivery ack
    └── Transport Layer (WebSocket Client)
        ├── connect + auth
        ├── heartbeat (ping/pong)
        └── reconnect + resume
```

传输方式：单 WebSocket 双向通信。插件作为 WebSocket 客户端主动连接 Xalgo Voice Channel Server（已存在），inbound 和 outbound 都走同一个连接。

---

## 3. 技术栈

- 语言：TypeScript
- 运行时：Node.js
- WebSocket 库：ws ^8.18.0
- 测试框架：vitest ^2.0.0
- 构建：tsc (TypeScript Compiler)

---

## 4. 文件结构

```
voice-openclaw-plugin/
├── package.json
├── openclaw.plugin.json
├── tsconfig.json
├── index.ts                      # 入口：注册 Channel Plugin
├── setup-entry.ts                # 绑定码配置引导
├── src/
│   ├── channel.ts                # Channel Layer: inbound/outbound adapter
│   ├── config.ts                 # 配置类型定义与读取
│   ├── client.ts                 # Transport: WebSocket 客户端
│   ├── reconnect.ts              # Transport: 指数退避重连 + resume
│   ├── protocol.ts               # Protocol: 事件类型定义 + 分发
│   ├── inbound.ts                # Protocol: Xalgo → OpenClaw 消息转换
│   ├── outbound.ts               # Protocol: OpenClaw → Xalgo 消息转换
│   ├── confirmation.ts           # Protocol: 确认请求/响应/超时
│   ├── interrupt.ts              # Protocol: 打断处理 + playback ledger
│   ├── streaming.ts              # Protocol: outbound_delta 流式处理
│   ├── delivery-ack.ts           # Protocol: 投递确认
│   ├── session.ts                # Session 映射管理
│   └── logger.ts                 # 日志
├── test/
│   ├── unit/
│   │   ├── protocol.test.ts
│   │   ├── inbound.test.ts
│   │   ├── outbound.test.ts
│   │   ├── reconnect.test.ts
│   │   ├── confirmation.test.ts
│   │   ├── interrupt.test.ts
│   │   └── session.test.ts
│   └── integration/
│       ├── mock-server.ts        # Mock Xalgo Channel Server
│       ├── connect.test.ts       # 连接 + 鉴权完整链路
│       └── message-flow.test.ts  # 消息收发完整链路
└── docs/
    ├── protocol.md
    ├── setup.md
    └── security.md
```

---

## 5. 模块职责

| 模块 | 层级 | 职责 |
|------|------|------|
| `index.ts` | Entry | 调用 `api.registerChannel()` 注册插件 |
| `setup-entry.ts` | Entry | OpenClaw 安装后配置引导：提示用户输入绑定码，验证连通性，写入 token |
| `channel.ts` | Channel | 实现 InboundAdapter / OutboundAdapter 接口 |
| `config.ts` | Channel | 定义 `XalgoVoiceConfig` 类型，读取 OpenClaw 配置 |
| `client.ts` | Transport | WebSocket 连接管理、send/receive、ping/pong |
| `reconnect.ts` | Transport | 指数退避（1s→2s→5s→15s→30s）、resume |
| `protocol.ts` | Protocol | 所有 XVC 事件类型定义 + 事件路由分发器 |
| `inbound.ts` | Protocol | `inbound_message` → OpenClaw `InboundMessage` |
| `outbound.ts` | Protocol | OpenClaw reply → `outbound_message` / `outbound_delta` |
| `confirmation.ts` | Protocol | confirmation_request/response、pending 状态、超时 |
| `interrupt.ts` | Protocol | voice_interrupt、cancel run、playback ledger 追踪 |
| `streaming.ts` | Protocol | outbound_delta 流式输出、span/chunk 管理 |
| `delivery-ack.ts` | Protocol | 投递确认和状态追踪 |
| `session.ts` | Protocol | session ID 映射 (direct/room) |
| `logger.ts` | Infra | 日志抽象 |

---

## 6. 插件注册接口

参考飞书 Channel 源码实现：

```typescript
// index.ts
import type { OpenClawApi } from "openclaw";
import { createInboundAdapter, outbound } from "./src/channel.js";

export default function registerXalgoVoicePlugin(api: OpenClawApi) {
  api.registerChannel({
    plugin: {
      id: "xalgo_voice",
      meta: {
        id: "xalgo_voice",
        label: "Xalgo Voice",
        selectionLabel: "Xalgo Voice (语音)",
        docsPath: "/channels/xalgo-voice",
        blurb: "Talk to your OpenClaw agents through Xalgo voice devices.",
      },
      capabilities: {
        chatTypes: ["direct"],
        media: { images: false, files: false },
        reactions: false,
        threads: false,
        mentions: false,
        replyContext: true,
        streaming: true,          // 扩展：支持流式回复
        confirmation: true,       // 扩展：支持确认流程
        voiceInterrupt: true,     // 扩展：支持语音打断
      },
      config: {
        listAccountIds: (cfg) => ["default"],
        resolveAccount: (cfg, accountId) =>
          cfg.channels?.xalgoVoice ?? { accountId: "default" },
      },
      outbound,
      inbound: createInboundAdapter(),
    },
  });
}
```

---

## 7. WebSocket 连接协议 (XVC)

### 7.1 连接建立

```json
{
  "type": "connect",
  "protocol_version": 1,
  "client": {
    "kind": "openclaw",
    "plugin": "@xalgo/voice-openclaw-plugin",
    "plugin_version": "0.1.0",
    "instance_id": "<openclaw_instance_id>",
    "device_name": "<user_defined_name>"
  },
  "channel": "xalgo_voice",
  "auth": { "token": "<XALGO_CHANNEL_TOKEN>" },
  "capabilities": [
    "text_message",
    "streaming_reply",
    "confirmation",
    "background_notification",
    "voice_interrupt",
    "delivery_ack"
  ]
}
```

服务端响应：

```json
{
  "type": "connected",
  "connection_id": "<conn_id>",
  "user_id": "<xalgo_user_id>",
  "heartbeat_interval_ms": 15000,
  "server_capabilities": [
    "asr_final",
    "tts_playback",
    "phone_confirm_card",
    "duplex_interrupt"
  ]
}
```

### 7.2 心跳

```json
{ "type": "ping", "ts": <timestamp_ms> }
{ "type": "pong", "ts": <timestamp_ms> }
```

连续 miss 3 个 pong → 主动断开，触发重连。

### 7.3 Resume

```json
{
  "type": "resume",
  "connection_id": "<previous_conn_id>",
  "last_event_id": "<last_received_event_id>",
  "auth": { "token": "<XALGO_CHANNEL_TOKEN>" }
}
```

重连策略：1s → 2s → 5s → 15s → 30s 指数退避，cap 30s。

### 7.4 通用 Envelope

所有事件共享：

```json
{
  "event_id": "<unique_id>",
  "type": "<event_type>",
  "created_at": <timestamp_ms>,
  "idempotency_key": "<unique_key>",
  "payload": {}
}
```

---

## 8. 核心事件类型

### 8.1 inbound_message（Xalgo → OpenClaw）

```json
{
  "type": "inbound_message",
  "payload": {
    "message_id": "<id>",
    "chat_id": "xalgo:user:<user_id>",
    "chat_type": "direct",
    "sender": { "id": "<user_id>", "name": "<name>" },
    "text": "<ASR transcript>",
    "metadata": {
      "input_type": "voice",
      "language": "zh-CN",
      "asr_confidence": 0.93,
      "device_id": "<device_id>",
      "wake_source": "wake_word",
      "duplex_session_id": "<session_id>"
    }
  }
}
```

### 8.2 outbound_message（OpenClaw → Xalgo）

```json
{
  "type": "outbound_message",
  "payload": {
    "message_id": "<id>",
    "chat_id": "xalgo:user:<user_id>",
    "reply_to": "<original_message_id>",
    "text": "<agent reply>",
    "metadata": {
      "output_type": "voice_preferred",
      "priority": "normal",
      "speak": true,
      "phone_push": false
    }
  }
}
```

### 8.3 outbound_delta（流式回复）

```json
{
  "type": "outbound_delta",
  "payload": {
    "message_id": "<id>",
    "chat_id": "xalgo:user:<user_id>",
    "delta_seq": 1,
    "text_delta": "<partial text>",
    "span_id": "<span_id>",
    "is_final": false
  }
}
```

### 8.4 confirmation_request（确认请求）

```json
{
  "type": "confirmation_request",
  "payload": {
    "confirmation_id": "<id>",
    "chat_id": "xalgo:user:<user_id>",
    "reply_to": "<original_message_id>",
    "text": "<confirmation prompt>",
    "risk_level": "R2",
    "expires_at": <timestamp_ms>,
    "confirm_methods": ["voice", "phone_card"]
  }
}
```

### 8.5 confirmation_response（用户确认）

```json
{
  "type": "confirmation_response",
  "payload": {
    "confirmation_id": "<id>",
    "chat_id": "xalgo:user:<user_id>",
    "result": "confirmed" | "denied" | "timeout",
    "text": "<user said>",
    "asr_confidence": 0.95,
    "method": "voice" | "phone_card"
  }
}
```

### 8.6 voice_interrupt（打断）

```json
{
  "type": "voice_interrupt",
  "payload": {
    "chat_id": "xalgo:user:<user_id>",
    "duplex_session_id": "<session_id>",
    "interrupted_message_id": "<msg_id>",
    "text": "<new intent>",
    "decision": "STOP",
    "played_until": {
      "span_id": "<span_id>",
      "chunk_seq": 21
    },
    "ledger_summary": {
      "delivered_text": "<what user heard>",
      "not_delivered": true
    },
    "metadata": {
      "asr_confidence": 0.91,
      "barge_in_type": "semantic_stop"
    }
  }
}
```

### 8.7 delivery_ack

```json
{
  "type": "delivery_ack",
  "payload": {
    "message_id": "<id>",
    "status": "delivered" | "played" | "failed",
    "played_until": { "span_id": "<id>", "chunk_seq": 15 }
  }
}
```

### 8.8 task_started / task_done

```json
{ "type": "task_started", "payload": { "task_id": "<id>", "text": "开始处理..." } }
{ "type": "task_done", "payload": { "task_id": "<id>", "text": "已完成", "result_summary": "..." } }
```

---

## 9. 数据流

### 9.1 正常消息

```
用户说话 → Pupa ASR → Channel Server → [WebSocket] → client.ts
→ protocol.ts dispatch → inbound.ts parse → channel.ts handleMessage()
→ OpenClaw Agent → channel.ts outbound.sendText()
→ outbound.ts format → client.ts send → [WebSocket]
→ Channel Server → TTS → 眼镜播报
```

### 9.2 流式回复

```
OpenClaw Agent streaming → streaming.ts 切片
→ outbound_delta events → client.ts send
→ Channel Server → 实时 TTS → 边生成边播报
```

### 9.3 确认

```
Agent 判断 R2+ → confirmation.ts 生成 request → send
→ 用户语音/手机确认 → confirmation_response → receive
→ confirmation.ts 匹配 + 清除 pending → 通知 Agent 继续/取消
```

### 9.4 打断

```
用户打断 → Pupa 检测 → voice_interrupt event → receive
→ interrupt.ts: 记录 played_until, cancel run, 提取新意图
→ inbound.ts: 新意图作为 follow-up → Agent 按新意图回复
```

### 9.5 重连

```
断开 → reconnect.ts: 指数退避 → resume event (last_event_id)
→ Server 回放 pending events → 恢复正常
```

---

## 10. Session 映射

格式：
- Direct: `xalgo_voice:direct:<xalgo_user_id>`
- Room: `xalgo_voice:room:<room_id>`

规则：
- 同一用户的眼镜/手机共用 direct session
- 打断事件路由到同一 session
- 确认事件路由回原 pending action

---

## 11. 风险策略

| 级别 | 说明 | 处理 |
|------|------|------|
| R0 | 查询类 | 直接执行 |
| R1 | 低风险写入 | 执行并播报结果 |
| R2 | 外发/影响他人 | 必须二次确认 |
| R3 | 删除/支付/公开发布 | 必须手机确认，禁止纯语音 |

---

## 12. 错误处理

| 场景 | 处理 |
|------|------|
| WebSocket 连接失败 | 指数退避重连 |
| 鉴权失败 (token invalid) | 停止重连，status "auth_failed" |
| 心跳超时 (miss 3 pongs) | 主动断开，触发重连 |
| 消息格式错误 | warn 日志，跳过，不中断连接 |
| 确认超时 | "timeout" 结果，通知 Agent 取消 |
| resume 失败 | 降级为全新 connect |
| Agent 处理异常 | outbound error 通知 Xalgo |

---

## 13. 配置 Schema

```typescript
interface XalgoVoiceConfig {
  enabled: boolean;
  serverUrl: string;              // "wss://asr-test.jlpay.com/agent-channel/connect"
  token: string;                  // XALGO_CHANNEL_TOKEN
  agentId: string;                // "voice"
  sessionPrefix: string;          // "xalgo_voice"
  streaming: boolean;             // true
  replyMode: "voice_first" | "text_first" | "both";
  riskPolicy: {
    confirmExternalSend: boolean;
    confirmDangerousTools: boolean;
    allowPureVoiceR3: boolean;    // false
  };
  reconnect: {
    minDelayMs: number;           // 1000
    maxDelayMs: number;           // 30000
    resume: boolean;              // true
  };
}
```

---

## 14. 安全原则

1. 不保存 OpenClaw Gateway Token，只保存 Xalgo Channel Token
2. OpenClaw 主动出站连接，不暴露内网端口
3. 强制 wss:// 加密传输
4. Token 支持 revoke / rotate
5. 所有事件有 event_id + idempotency_key，断线重连不重复执行副作用
6. R3 操作禁止纯语音确认
7. Tool policy 仍由 OpenClaw 自己控制

---

## 15. 测试策略

### 单元测试

- protocol.ts：事件解析、类型校验、分发路由
- inbound.ts：各种 payload 到 InboundMessage 的转换
- outbound.ts：Agent 回复到 XVC 事件的转换
- reconnect.ts：退避算法、resume 逻辑
- confirmation.ts：状态机、超时处理
- interrupt.ts：打断逻辑、ledger 追踪
- session.ts：ID 映射规则

### 集成测试

- mock-server.ts：模拟 Xalgo Channel Server WebSocket 端
- connect.test.ts：连接 → 鉴权 → connected 完整链路
- message-flow.test.ts：说话 → Agent → 回复完整链路

---

## 16. 实现范围（全量）

包含方案文档 Phase 1 + Phase 2 + Phase 3 的全部功能：

**Phase 1 基础**：插件工程、配置、WebSocket 连接、鉴权、心跳、断线重连、inbound/outbound 消息、direct session、简单 confirmation

**Phase 2 增强**：outbound_delta 流式回复、delivery_ack、task_started/done、phone confirm card、reconnect resume、idempotency/dedupe

**Phase 3 全双工**：voice_interrupt、playback ledger、cancel 当前输出、follow-up、reply chunk tracking、高风险 approval 手机化

---

## 17. 依赖

```json
{
  "name": "@xalgo/voice-openclaw-plugin",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/ws": "^8.5.0"
  }
}
```

---

## 18. 与飞书 Channel 的异同

| 方面 | 飞书 Channel | Xalgo Voice Channel |
|------|-------------|---------------------|
| 传输 | WebSocket (飞书 API) | WebSocket (Xalgo Server) |
| 连接方向 | 插件主动连接飞书 | 插件主动连接 Xalgo |
| 消息格式 | 飞书事件 | XVC 协议 |
| 鉴权 | appId + appSecret | channel token |
| 输入类型 | 文字/图片/文件 | 语音 ASR 文本 |
| 输出类型 | 文字/卡片/图片 | 语音 TTS |
| 特有能力 | @mention、pairing | 打断、确认、流式 TTS |
| Plugin 接口 | api.registerChannel() | api.registerChannel() (相同) |
