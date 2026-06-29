# voice-openclaw-plugin 方案

版本：V0.1  
日期：2026-05-14  
工程名：`voice-openclaw-plugin`  
包名：`@xalgo/voice-openclaw-plugin`  
展示名：`Xalgo Voice`

---

## 1. 工程定位

`voice-openclaw-plugin` 是 Xalgo 面向 OpenClaw 的第三方 Channel 插件。

一句话定位：

> 让用户通过 Xalgo 眼镜语音实时控制自己的 OpenClaw Agent。

它的角色类似：

```text
Feishu Channel
WeCom Channel
Telegram Channel
Discord Channel
Xalgo Voice Channel
```

核心不是做 AI Agent 本体，而是把 Xalgo 的语音通道接入 OpenClaw 的消息系统。

---

## 2. 最终命名表

| 项目 | 名称 |
|---|---|
| Git 仓库名 | `voice-openclaw-plugin` |
| npm 包名 | `@xalgo/voice-openclaw-plugin` |
| OpenClaw 展示名 | `Xalgo Voice` |
| OpenClaw channel id | `xalgo_voice` |
| OpenClaw 配置 key | `xalgoVoice` |
| 服务端工程 | `xalgo-voice-channel-server` |
| 协议名 | `Xalgo Voice Channel Protocol` |
| 协议简称 | `XVC` |

---

## 3. 核心架构

正确架构：

```text
Xalgo Glasses
  ↓ audio uplink / playback downlink
Xalgo App / Pupa Cloud
  ↓ ASR / TTS / Duplex / Confirmation
Xalgo Voice Channel Server
  ↑↓ outbound WebSocket
OpenClaw Gateway
  ↓
OpenClaw Agent / Tools / Memory / Automations
```

关键原则：

```text
OpenClaw 主动连接 Xalgo Channel Server
Xalgo 不主动访问用户内网 OpenClaw
Xalgo 不保存 OpenClaw Gateway Token
OpenClaw 自己管理工具权限和审批
```

---

## 4. 为什么要做成 Channel 插件

眼镜语音对 OpenClaw 来说，本质是一种新的输入输出渠道。

类比：

```text
飞书：用户发文字 → Feishu Channel → OpenClaw Agent → 回复飞书
企微：用户发文字 → WeCom Channel → OpenClaw Agent → 回复企微
Xalgo：用户说话 → Xalgo Voice Channel → OpenClaw Agent → 回复语音
```

所以不应该让 Xalgo 直接调用用户 OpenClaw API，而应该让用户自己的 OpenClaw 安装 Xalgo Channel。

错误路线：

```text
Xalgo Cloud → 调用户 OpenClaw Gateway API ❌
Xalgo Cloud 保存用户 OpenClaw Gateway Token ❌
用户必须暴露公网 OpenClaw ❌
```

正确路线：

```text
OpenClaw 安装 Xalgo Channel ✅
OpenClaw 主动连接 Xalgo Channel Server ✅
Xalgo 只保存 channel token ✅
OpenClaw tool policy / approval 自己控制 ✅
```

---

## 5. 用户使用流程

### 5.1 安装插件

用户在 OpenClaw 环境里安装：

```bash
npm install @xalgo/voice-openclaw-plugin
```

或通过 OpenClaw 插件市场安装：

```text
Xalgo Voice
```

### 5.2 绑定 OpenClaw

用户在 Xalgo App 中点击：

```text
连接 OpenClaw
```

App 生成：

```text
绑定码 / QR Code
```

用户在 OpenClaw 里输入绑定码，插件拿到：

```text
XALGO_CHANNEL_TOKEN
```

### 5.3 建立连接

OpenClaw 启动后主动连接：

```text
wss://asr-test.jlpay.com/agent-channel/connect
```

Xalgo App 显示：

```text
OpenClaw 已连接
```

### 5.4 语音交互

用户对眼镜说：

```text
帮我看看今天有什么待办
```

链路：

```text
眼镜收音
→ Pupa ASR
→ Xalgo Channel Server
→ voice-openclaw-plugin
→ OpenClaw Agent
→ OpenClaw 返回文本
→ Xalgo TTS
→ 眼镜播报
```

---

## 6. 插件职责边界

### 6.1 插件负责

```text
1. 读取 OpenClaw 配置
2. 持有 Xalgo channel token
3. 主动连接 Xalgo Voice Channel Server
4. 心跳、断线重连、resume
5. 接收 Xalgo 的 ASR final transcript
6. 转成 OpenClaw inbound message
7. 接收 OpenClaw outbound reply
8. 转成 Xalgo outbound_message / outbound_delta
9. 支持语音确认
10. 支持用户打断
11. 支持长任务开始/完成通知
12. 支持 delivery ack
```

### 6.2 插件不负责

```text
1. 不做 ASR
2. 不做 TTS
3. 不做 AEC
4. 不做音频编解码
5. 不直接执行工具
6. 不判断 OpenClaw 工具权限
7. 不保存 OpenClaw Gateway Token
```

ASR/TTS/全双工属于 Xalgo Pupa Cloud。  
工具执行和审批属于 OpenClaw。

---

## 7. 工程结构建议

```text
voice-openclaw-plugin/
├── package.json
├── openclaw.plugin.json
├── tsconfig.json
├── README.md
├── index.ts
├── setup-entry.ts
├── src/
│   ├── channel.ts
│   ├── config.ts
│   ├── client.ts
│   ├── protocol.ts
│   ├── inbound.ts
│   ├── outbound.ts
│   ├── reconnect.ts
│   ├── confirmation.ts
│   ├── interrupt.ts
│   ├── delivery-ack.ts
│   └── logger.ts
├── test/
│   ├── config.test.ts
│   ├── protocol.test.ts
│   ├── inbound.test.ts
│   └── reconnect.test.ts
└── docs/
    ├── protocol.md
    ├── setup.md
    └── security.md
```

---

## 8. package.json 草案

```json
{
  "name": "@xalgo/voice-openclaw-plugin",
  "version": "0.1.0",
  "type": "module",
  "description": "Xalgo Voice Channel plugin for OpenClaw.",
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "xalgo_voice",
      "label": "Xalgo Voice",
      "blurb": "Talk to your OpenClaw agents through Xalgo voice devices."
    }
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

---

## 9. openclaw.plugin.json 草案

```json
{
  "id": "xalgo_voice",
  "kind": "channel",
  "channels": ["xalgo_voice"],
  "name": "Xalgo Voice",
  "description": "Voice channel plugin that connects Xalgo glasses and Pupa voice cloud to OpenClaw agents.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "xalgoVoice": {
        "type": "object",
        "properties": {
          "enabled": {
            "type": "boolean",
            "default": false
          },
          "serverUrl": {
            "type": "string",
            "default": "wss://asr-test.jlpay.com/agent-channel/connect"
          },
          "token": {
            "type": "string"
          },
          "agentId": {
            "type": "string",
            "default": "voice"
          },
          "sessionPrefix": {
            "type": "string",
            "default": "xalgo_voice"
          },
          "streaming": {
            "type": "boolean",
            "default": true
          },
          "replyMode": {
            "type": "string",
            "default": "voice_first"
          }
        },
        "required": ["token"]
      }
    }
  }
}
```

---

## 10. OpenClaw 配置草案

```json5
{
  "channels": {
    "xalgoVoice": {
      "enabled": true,
      "serverUrl": "wss://asr-test.jlpay.com/agent-channel/connect",
      "token": "${XALGO_CHANNEL_TOKEN}",
      "agentId": "voice",
      "sessionPrefix": "xalgo_voice",
      "streaming": true,
      "replyMode": "voice_first",
      "riskPolicy": {
        "confirmExternalSend": true,
        "confirmDangerousTools": true,
        "allowPureVoiceR3": false
      },
      "reconnect": {
        "minDelayMs": 1000,
        "maxDelayMs": 30000,
        "resume": true
      }
    }
  }
}
```

---

## 11. WebSocket 连接协议

OpenClaw 插件主动连接：

```text
wss://asr-test.jlpay.com/agent-channel/connect
```

### 11.1 connect

```json
{
  "type": "connect",
  "protocol_version": 1,
  "client": {
    "kind": "openclaw",
    "plugin": "@xalgo/voice-openclaw-plugin",
    "plugin_version": "0.1.0",
    "instance_id": "oc_abc",
    "device_name": "Yangli OpenClaw"
  },
  "channel": "xalgo_voice",
  "auth": {
    "token": "xalgo_channel_token"
  },
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

### 11.2 connected

```json
{
  "type": "connected",
  "connection_id": "conn_abc",
  "user_id": "xalgo_user_123",
  "heartbeat_interval_ms": 15000,
  "server_capabilities": [
    "asr_final",
    "tts_playback",
    "phone_confirm_card",
    "duplex_interrupt"
  ]
}
```

### 11.3 心跳

```json
{ "type": "ping", "ts": 1778120000000 }
{ "type": "pong", "ts": 1778120000100 }
```

### 11.4 resume

```json
{
  "type": "resume",
  "connection_id": "conn_abc",
  "last_event_id": "evt_1024",
  "auth": {
    "token": "xalgo_channel_token"
  }
}
```

重连策略：

```text
1s / 2s / 5s / 15s / 30s 指数退避
支持 last_event_id 恢复
所有副作用事件必须有 idempotency_key
断线期间 Channel Server 保留 pending events
```

---

## 12. 核心事件协议

### 12.1 通用 Envelope

```json
{
  "event_id": "evt_001",
  "type": "inbound_message",
  "created_at": 1778120000000,
  "idempotency_key": "idem_001",
  "payload": {}
}
```

### 12.2 语音输入进入 OpenClaw

Xalgo → OpenClaw：

```json
{
  "event_id": "evt_voice_001",
  "type": "inbound_message",
  "created_at": 1778120000000,
  "payload": {
    "message_id": "voice_msg_001",
    "chat_id": "xalgo:user:123",
    "chat_type": "direct",
    "sender": {
      "id": "xalgo_user_123",
      "name": "杨立"
    },
    "text": "看看我今天有什么待办",
    "metadata": {
      "input_type": "voice",
      "language": "zh-CN",
      "asr_confidence": 0.93,
      "device_id": "glasses_abc",
      "wake_source": "wake_word",
      "duplex_session_id": "duplex_789"
    }
  }
}
```

插件把它转成 OpenClaw inbound message。

### 12.3 OpenClaw 回复到 Xalgo

OpenClaw → Xalgo：

```json
{
  "event_id": "evt_reply_001",
  "type": "outbound_message",
  "created_at": 1778120000500,
  "payload": {
    "message_id": "reply_001",
    "chat_id": "xalgo:user:123",
    "reply_to": "voice_msg_001",
    "text": "少爷，你今天有三个待办：上午确认报价，下午整理方案，晚上复盘全双工路线。",
    "metadata": {
      "output_type": "voice_preferred",
      "priority": "normal",
      "speak": true,
      "phone_push": false
    }
  }
}
```

Xalgo 收到后做 TTS 播报。

### 12.4 流式回复

```json
{
  "type": "outbound_delta",
  "payload": {
    "message_id": "reply_001",
    "chat_id": "xalgo:user:123",
    "delta_seq": 1,
    "text_delta": "少爷，你今天有三个待办：",
    "span_id": "span_001",
    "is_final": false
  }
}
```

作用：

```text
OpenClaw 边生成
Xalgo 边 TTS
降低语音等待时间
```

### 12.5 语音确认

OpenClaw 请求确认：

```json
{
  "type": "confirmation_request",
  "payload": {
    "confirmation_id": "confirm_123",
    "chat_id": "xalgo:user:123",
    "reply_to": "voice_msg_002",
    "text": "我将发给老王：我晚点到。确认发送吗？",
    "risk_level": "R2",
    "expires_at": 1778120060000,
    "confirm_methods": ["voice", "phone_card"]
  }
}
```

用户确认：

```json
{
  "type": "confirmation_response",
  "payload": {
    "confirmation_id": "confirm_123",
    "chat_id": "xalgo:user:123",
    "result": "confirmed",
    "text": "确认",
    "asr_confidence": 0.95,
    "method": "voice"
  }
}
```

风险策略：

```text
R0 查询类：直接执行
R1 低风险写入：可执行，播报结果
R2 外发/影响他人：必须二次确认
R3 删除/命令/改配置/支付/公开发布：必须手机确认或 OpenClaw approval，不允许纯语音放行
```

### 12.6 用户打断

用户在 OpenClaw 回复时说：

```text
停，直接说下午的
```

Xalgo 发送：

```json
{
  "type": "voice_interrupt",
  "payload": {
    "chat_id": "xalgo:user:123",
    "duplex_session_id": "duplex_789",
    "interrupted_message_id": "reply_001",
    "text": "停，直接说下午的",
    "decision": "STOP",
    "played_until": {
      "span_id": "span_003",
      "chunk_seq": 21
    },
    "ledger_summary": {
      "delivered_text": "少爷，你今天上午有...",
      "not_delivered": true
    },
    "metadata": {
      "asr_confidence": 0.91,
      "barge_in_type": "semantic_stop"
    }
  }
}
```

插件处理方式：

```text
1. 映射成同一 session 的 follow-up message
2. 尽量 cancel 当前 OpenClaw run
3. 把用户新意图送进 OpenClaw
4. 不把未播报文本当成已交付信息
```

---

## 13. Session 映射

建议：

```text
xalgo_voice:direct:<xalgo_user_id>
xalgo_voice:room:<room_id>
```

策略：

```text
同一用户的眼镜/手机共用 direct session
会议/房间模式用 room session
打断事件必须进入同一 session
确认事件必须路由回原 pending action
```

---

## 14. 推荐内置 Voice Agent

插件可以建议用户创建一个专用 agent：

```text
agent id: voice
```

系统风格：

```text
1. 回复短，适合 TTS
2. 不输出复杂 markdown 表格
3. 一句话结论优先
4. 长任务先 ack
5. 危险操作必须确认
6. 没播报完成的内容不要默认用户已经听到
```

默认提示词方向：

```text
你是用户的语音 AI 助手。用户通过 Xalgo 眼镜与你对话。
回复要短、清楚、适合语音播报。
涉及外发、删除、执行命令、公开发布、支付、修改配置等高风险动作时，必须请求确认。
长任务超过 10 秒时，先简短确认已开始，完成后再通知。
```

---

## 15. 安全原则

必须坚持：

```text
1. Xalgo 不保存 OpenClaw Gateway Token
2. Xalgo 只保存 Xalgo channel token
3. OpenClaw 主动连接 Xalgo
4. token 可 revoke / rotate
5. 所有事件有 event_id 和 idempotency_key
6. 断线重连不能重复执行副作用动作
7. R3 不能纯语音确认
8. Tool policy 仍由 OpenClaw 控制
```

---

## 16. MVP 范围

第一版不要贪多，做最小闭环。

### Phase 1：MVP，1-2 周

做：

```text
1. 插件基础工程
2. 配置读取
3. WebSocket 连接 Xalgo Channel Server
4. 鉴权
5. 心跳
6. 断线重连
7. inbound_message → OpenClaw message
8. OpenClaw reply → outbound_message
9. direct session
10. 简单 confirmation
```

不做：

```text
1. 不做复杂全双工
2. 不做 ASR partial
3. 不做 TTS streaming
4. 不做复杂 room routing
5. 不做多 OpenClaw 实例高级路由
```

验收：

```text
用户对眼镜说一句话
OpenClaw 收到
OpenClaw 回复
眼镜播报
```

### Phase 2：语音体验增强，2-4 周

做：

```text
1. outbound_delta 流式回复
2. TTS streaming 对接
3. delivery_ack
4. task_started / task_done
5. phone confirm card
6. reconnect resume
7. idempotency / dedupe
```

验收：

```text
长回复可以边生成边播报
长任务可以先说“我开始处理”
完成后主动通知用户
```

### Phase 3：全双工，4-8 周

做：

```text
1. voice_interrupt
2. playback ledger
3. 用户打断后 cancel 当前输出
4. “停，改成...” follow-up
5. OpenClaw reply chunk tracking
6. 高风险 approval 手机化
```

验收：

```text
用户可以自然打断 Agent
Agent 不会重复说已经被打断的内容
工具执行状态可以语音播报
```

---

## 17. 代码模块拆分

### 17.1 `src/client.ts`

负责：

```text
WebSocket 连接
send event
receive event
ping/pong
close/reconnect
```

### 17.2 `src/protocol.ts`

负责：

```text
定义所有 Xalgo Voice Channel Protocol 类型
校验 event schema
```

### 17.3 `src/channel.ts`

负责：

```text
注册 OpenClaw Channel Plugin
定义 outbound/inbound adapter
```

### 17.4 `src/inbound.ts`

负责：

```text
Xalgo inbound_message
→ OpenClaw inbound message
```

### 17.5 `src/outbound.ts`

负责：

```text
OpenClaw outbound reply
→ Xalgo outbound_message / outbound_delta
```

### 17.6 `src/confirmation.ts`

负责：

```text
confirmation_request
confirmation_response
pending confirmation state
timeout
```

### 17.7 `src/interrupt.ts`

负责：

```text
voice_interrupt
cancel/steer/follow-up
playback ledger metadata
```

### 17.8 `src/reconnect.ts`

负责：

```text
指数退避
resume
last_event_id
pending event replay
```

---

## 18. 和 Hermes 的关系

OpenClaw 插件名：

```text
@xalgo/voice-openclaw-plugin
```

Hermes 后续可以做：

```text
xalgo-voice-hermes-plugin
```

两者不是同一个插件包。

但共用：

```text
1. Xalgo Voice Channel Protocol
2. Xalgo Channel Server
3. 绑定流程
4. token 体系
5. ASR/TTS/全双工逻辑
```

区别只是适配层：

```text
OpenClaw：Channel Plugin
Hermes：Platform Adapter
```

---

## 19. 建议启动方式

第一步建仓库：

```bash
mkdir voice-openclaw-plugin
cd voice-openclaw-plugin
```

第一版目标：

```text
把 Xalgo ASR final transcript 变成 OpenClaw 的一条 inbound message，
再把 OpenClaw 的 reply 送回 Xalgo TTS。
```

不要一开始就做复杂全双工。

先跑通：

```text
说话 → OpenClaw → 播报
```

这就是 MVP 的命门。
