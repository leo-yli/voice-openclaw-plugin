# @xalgo/voice-openclaw-plugin

Xalgo Voice Channel 插件，让用户通过 Xalgo 眼镜语音实时控制自己的 OpenClaw Agent。

## 工作原理

```
Xalgo Glasses → Pupa Cloud (ASR/TTS) → Xalgo Voice Channel Server
                                              ↑↓ WebSocket
                                        voice-openclaw-plugin
                                              ↓
                                        OpenClaw Agent
```

- 插件作为 WebSocket 客户端**主动连接** Xalgo Channel Server
- OpenClaw 无需暴露公网端口，适用于内网部署
- 语音识别 (ASR) 和语音合成 (TTS) 由 Xalgo Pupa Cloud 处理，插件只负责消息转发

## 安装

### 通过 npm（推荐）

```bash
openclaw plugins install @xalgo/voice-openclaw-plugin
```

### 本地安装

```bash
git clone <this-repo>
cd voice-openclaw-plugin
npm install
npm run build
openclaw plugins install ./dist
```

## 配置

### 1. 获取绑定码

在 Xalgo App 中点击「连接 OpenClaw」，生成绑定码。

### 2. 运行配置向导

安装插件后，OpenClaw 会自动执行配置向导，提示输入：
- **Channel Token** — 从 Xalgo App 获取的绑定 Token
- **Server URL** — 默认 `wss://channel.xalgo.ai/openclaw/connect`

### 3. 手动配置（可选）

在 OpenClaw 配置文件 (`openclaw.json`) 中：

```json
{
  "channels": {
    "xalgoVoice": {
      "enabled": true,
      "serverUrl": "wss://channel.xalgo.ai/openclaw/connect",
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

也可以通过环境变量设置 Token：

```bash
export XALGO_CHANNEL_TOKEN="your_token_here"
```

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用插件 |
| `serverUrl` | string | `wss://channel.xalgo.ai/openclaw/connect` | Channel Server 地址 |
| `token` | string | (必填) | Xalgo Channel Token |
| `agentId` | string | `"voice"` | OpenClaw Agent ID |
| `sessionPrefix` | string | `"xalgo_voice"` | Session ID 前缀 |
| `streaming` | boolean | `true` | 是否启用流式回复（边生成边播报） |
| `replyMode` | string | `"voice_first"` | 回复模式：`voice_first` / `text_first` / `both` |
| `riskPolicy.confirmExternalSend` | boolean | `true` | 外发消息是否需要确认 |
| `riskPolicy.confirmDangerousTools` | boolean | `true` | 危险工具是否需要确认 |
| `riskPolicy.allowPureVoiceR3` | boolean | `false` | 是否允许纯语音确认 R3 操作 |
| `reconnect.minDelayMs` | number | `1000` | 重连最小延迟 (ms) |
| `reconnect.maxDelayMs` | number | `30000` | 重连最大延迟 (ms) |
| `reconnect.resume` | boolean | `true` | 断线后是否尝试恢复 session |

## 使用流程

### 基本语音交互

1. 用户对 Xalgo 眼镜说话
2. Pupa Cloud 完成语音识别，发送文本到 Channel Server
3. 插件收到消息，转发给 OpenClaw Agent
4. Agent 处理后回复文本
5. 插件将回复发回 Channel Server
6. Pupa Cloud 转为语音，通过眼镜播报

### 流式回复

启用 `streaming: true` 后，Agent 的回复会边生成边播报，降低语音等待时间。

### 确认机制

当 Agent 执行有风险的操作时，会请求用户确认：

| 风险等级 | 说明 | 确认方式 |
|----------|------|----------|
| R0 | 查询类操作 | 直接执行 |
| R1 | 低风险写入 | 执行后播报结果 |
| R2 | 外发/影响他人 | 语音或手机确认 |
| R3 | 删除/支付/公开发布 | 仅手机确认（默认禁止纯语音） |

### 语音打断

用户可以在 Agent 回复过程中随时打断，说出新的指令。插件会：
1. 停止当前回复的播报
2. 记录已播报/未播报内容
3. 将新指令发给 Agent 继续处理

## 开发

```bash
npm install          # 安装依赖
npm run build        # 编译
npm run dev          # watch 模式编译
npm test             # 运行测试
npm run lint         # 类型检查
```

### 项目结构

```
src/
├── channel.ts        # OpenClaw Channel 适配层
├── client.ts         # WebSocket 客户端
├── config.ts         # 配置类型与默认值
├── protocol.ts       # XVC 协议事件类型定义
├── inbound.ts        # 入站消息解析 (Xalgo → OpenClaw)
├── outbound.ts       # 出站消息格式化 (OpenClaw → Xalgo)
├── streaming.ts      # 流式回复管理
├── confirmation.ts   # 确认状态机
├── interrupt.ts      # 语音打断处理
├── delivery-ack.ts   # 投递确认追踪
├── reconnect.ts      # 断线重连管理
├── session.ts        # Session ID 映射
└── logger.ts         # 日志
```

## 安全

- 插件**不保存** OpenClaw Gateway Token，只保存 Xalgo Channel Token
- 所有通信强制使用 `wss://` 加密传输
- Token 支持随时撤销 (revoke) 和轮换 (rotate)
- 所有事件有幂等性 key，断线重连不会重复执行副作用操作
- 工具执行权限仍由 OpenClaw 自身控制

## 许可证

MIT
