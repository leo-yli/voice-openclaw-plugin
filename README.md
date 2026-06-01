# @xalgo/voice-openclaw-plugin

Xalgo Voice Channel 插件，让用户通过 Xalgo 眼镜语音实时控制自己的 OpenClaw Agent。

中文 | [English](./README.en.md)

---

@xalgo/voice-openclaw-plugin 是一个 OpenClaw Channel 插件，让用户通过 Xalgo 眼镜语音实时控制自己的 OpenClaw Agent。插件作为 WebSocket 客户端主动连接 Xalgo Voice Channel Server，不需要 OpenClaw 暴露公网端口。

## 工作原理

```text
Xalgo Glasses -> Pupa Cloud (ASR/TTS) -> Xalgo Voice Channel Server
                                                ^ v WebSocket
                                          voice-openclaw-plugin
                                                |
                                          OpenClaw Agent
```

- 插件作为 WebSocket 客户端主动连接 Xalgo Channel Server。
- OpenClaw 无需暴露公网端口，适用于内网部署。
- 语音识别 (ASR) 和语音合成 (TTS) 由 Xalgo Pupa Cloud 处理，插件只负责协议转换和消息转发。

## 快速开始

前置要求：

- OpenClaw `>= 2026.3.28`
- Node.js `>= 20`，推荐 Node.js 22+，可避免 JSON import 的 experimental warning

接入流程：安装插件 -> 绑定账号 -> 重启 OpenClaw。

### 1. 安装插件

按场景选择一种安装方式。

#### 方式 A：从 npm 安装

```bash
openclaw plugins install @xalgo/voice-openclaw-plugin
```

如果 npm 包尚未发布，请先使用方式 B。从发布包安装后，后续绑定和运行命令保持一致。

#### 方式 B：从 GitHub clone 安装

适合 npm 包未发布、需要锁定到具体 commit，或者本地调试插件的场景。

```bash
cd ~
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin
npm install
openclaw plugins install .
```

`openclaw plugins install` 不接受 URL 形式，不能使用 `openclaw plugins install git+https://...`。必须先在本地 clone，再 install `.`，因为 OpenClaw 需要读取本地 `package.json`。

#### 方式 C：分发 tarball

适合开发机或 CI 能联网，但 OpenClaw 主机不能直接联网安装 npm 包的环境。

```bash
# 开发机或 CI 上：
cd voice-openclaw-plugin
npm install
npm pack
# 生成 xalgo-voice-openclaw-plugin-2026.5.16.tgz

# OpenClaw 主机上：
openclaw plugins install /path/to/xalgo-voice-openclaw-plugin-2026.5.16.tgz
```

#### 方式 D：离线复制到 extensions 目录

只在完全不能运行 `openclaw plugins install` 时使用。

```bash
# 在能联网的机器上 build 并打包 production 依赖：
cd voice-openclaw-plugin
npm install
npm run build
npm install --omit=dev
tar czf plugin.tar.gz dist node_modules endpoints.json openclaw.plugin.json package.json README.md README.en.md

# 推到 OpenClaw 主机并解压：
scp plugin.tar.gz root@<host>:/tmp/
ssh root@<host>
mkdir -p ~/.openclaw/extensions/xalgo_voice
tar xzf /tmp/plugin.tar.gz -C ~/.openclaw/extensions/xalgo_voice
```

这种方式 OpenClaw 会标记为 `loaded without install/load-path provenance`。需要手动在 `~/.openclaw/openclaw.json` 的 `plugins.allow` 中加入 `xalgo_voice` 才能被信任执行。

### 2. 运行 channel 配置向导

```bash
openclaw channels add
```

在向导中选择 `Xalgo Voice (语音)`，按提示输入 Xalgo App 给出的 8 位绑定码。向导会自动调用 exchange 接口换取长期 Channel Token，并写入 OpenClaw 配置。

绑定码获取方式：打开 Xalgo App，点击「连接 OpenClaw」，App 会显示一个 8 位绑定码，5 分钟内有效。

### 3. 重启 OpenClaw

```bash
openclaw gateway restart
# 或使用对应的 systemctl / supervisor 命令
```

启动日志中应该看到类似输出：

```text
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] WebSocket connected
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] Authenticated, connection_id=...
```

也可以用下面的命令验证插件已加载：

```bash
openclaw plugins list | grep xalgo
openclaw plugins inspect xalgo_voice
```

看到 `xalgo_voice` channel 后，即可通过 Xalgo 眼镜语音触发 OpenClaw Agent。

## 升级

### npm 安装方式

```bash
openclaw plugins update @xalgo/voice-openclaw-plugin
openclaw gateway restart
```

也可以重新 install 同名包。

### GitHub clone 安装方式

```bash
cd ~/voice-openclaw-plugin
git pull
npm install
npm run build
openclaw plugins uninstall xalgo_voice
rm -rf ~/.openclaw/extensions/xalgo_voice
openclaw plugins install .
openclaw channels add
openclaw gateway restart
```

不要在 `openclaw plugins uninstall xalgo_voice` 之前直接删除 `~/.openclaw/extensions/xalgo_voice`。直接删除扩展目录会留下 stale config，可能导致 OpenClaw 报 `unknown channel id` 或 `plugin not found`。如果 install 提示 `plugin already exists`，先执行官方 uninstall，再删除残留目录并重新 install。

## 重新绑定、解绑、切换账号

绑定后如果想更换 Xalgo 账号，或者怀疑 token 泄漏需要 rotate，可以使用以下方式。

### 方式 A：重新运行 `openclaw channels add`

向导会检测到已有绑定，并提示保持、重新绑定或解绑。

### 方式 B：使用独立 CLI `xalgo-bind`

如果 OpenClaw 版本不支持 `channels add`，或者需要脚本化操作：

```bash
node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js
```

可选地在 shell 配置中添加 alias：

```bash
alias xalgo-bind='node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js'
```

之后可以用 `xalgo-bind` 执行绑定或解绑。

### 方式 C：在 Xalgo App 端解绑

在 Xalgo App 的设备列表中点击对应 OpenClaw，然后移除或 rotate token。App 操作后，服务端会通过 WebSocket 推送 `binding_revoked` 或 `token_rotated_notify`，插件会自动清空或更换本地凭据。

## 手动配置

绑定向导写入的字段位于 `~/.openclaw/openclaw.json` 的 `channels.xalgo_voice.*` 下。通常不需要手动修改。如果需要切换 API 端点或调试，可以参考下面的 schema：

```json
{
  "channels": {
    "xalgo_voice": {
      "enabled": true,
      "serverUrl": "wss://asr-test.jlpay.com/openclaw/connect",
      "apiBaseUrl": "https://asr-test.jlpay.com",
      "token": "<绑定向导自动写入>",
      "instanceId": "<绑定向导自动写入>",
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

默认 `serverUrl` 和 `apiBaseUrl` 来自项目根目录的 `endpoints.json`。开发者切换测试或生产环境时，只需要改这个文件。终端用户不要修改 `node_modules` 里的 `endpoints.json`，请通过 OpenClaw 配置覆盖 `channels.xalgo_voice.serverUrl` 或 `channels.xalgo_voice.apiBaseUrl`。

### 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否启用插件，绑定向导成功后自动设为 `true` |
| `serverUrl` | string | `wss://asr-test.jlpay.com/openclaw/connect` | WebSocket Channel Server 地址 |
| `apiBaseUrl` | string | `https://asr-test.jlpay.com` | REST API base，用于 exchange、rotate、unbind |
| `token` | string | 绑定向导自动写入 | Xalgo Channel Token，请勿手动修改 |
| `instanceId` | string | 绑定向导自动生成 UUID v4 | 插件实例 ID，作为设备指纹参与鉴权 |
| `boundUserId` / `boundUserName` / `boundAt` | string | 绑定向导自动写入 | 仅供展示 |
| `deviceLabel` | string | `OpenClaw on <hostname>` | Xalgo App 侧显示的设备标签 |
| `agentId` | string | `voice` | OpenClaw Agent ID |
| `sessionPrefix` | string | `xalgo_voice` | Session ID 前缀 |
| `streaming` | boolean | `true` | 是否启用流式回复 |
| `replyMode` | string | `voice_first` | 回复模式：`voice_first` / `text_first` / `both` |
| `riskPolicy.confirmExternalSend` | boolean | `true` | 外发消息是否需要确认 |
| `riskPolicy.confirmDangerousTools` | boolean | `true` | 危险工具是否需要确认 |
| `riskPolicy.allowPureVoiceR3` | boolean | `false` | 是否允许纯语音确认 R3 操作 |
| `reconnect.minDelayMs` | number | `1000` | 重连最小延迟，单位 ms |
| `reconnect.maxDelayMs` | number | `30000` | 重连最大延迟，单位 ms |
| `reconnect.resume` | boolean | `true` | 断线后是否尝试恢复 session |

## 使用流程

### 基本语音交互

1. 用户对 Xalgo 眼镜说话。
2. Pupa Cloud 完成语音识别，并把文本发送到 Channel Server。
3. 插件收到消息并转发给 OpenClaw Agent。
4. Agent 处理后回复文本。
5. 插件将回复发回 Channel Server。
6. Pupa Cloud 转为语音，通过眼镜播报。

### 流式回复

启用 `streaming: true` 后，Agent 的回复会边生成边播报，降低语音等待时间。

### 确认机制

当 Agent 执行有风险的操作时，会请求用户确认：

| 风险等级 | 说明 | 确认方式 |
| --- | --- | --- |
| R0 | 查询类操作 | 直接执行 |
| R1 | 低风险写入 | 执行后播报结果 |
| R2 | 外发或影响他人 | 语音或手机确认 |
| R3 | 删除、支付、公开发布 | 仅手机确认，默认禁止纯语音 |

### 语音打断

用户可以在 Agent 回复过程中随时打断，说出新的指令。插件会：

1. 停止当前回复的播报。
2. 记录已播报和未播报内容。
3. 将新指令发给 Agent 继续处理。

## 开发

```bash
npm install
npm run build
npm run dev
npm test
npm run lint
```

### 项目结构

```text
src/
├── channel.ts        # OpenClaw Channel 适配层
├── client.ts         # WebSocket 客户端
├── config.ts         # 配置类型与默认值
├── protocol.ts       # XVC 协议事件类型定义
├── inbound.ts        # 入站消息解析 (Xalgo -> OpenClaw)
├── outbound.ts       # 出站消息格式化 (OpenClaw -> Xalgo)
├── streaming.ts      # 流式回复管理
├── confirmation.ts   # 确认状态机
├── interrupt.ts      # 语音打断处理
├── delivery-ack.ts   # 投递确认追踪
├── reconnect.ts      # 断线重连管理
├── session.ts        # Session ID 映射
└── logger.ts         # 日志
```

## 安全

- 插件不保存 OpenClaw Gateway Token，只保存 Xalgo Channel Token。
- 所有通信强制使用 `wss://` 加密传输。
- Token 支持随时 revoke 和 rotate。
- 所有事件带有幂等性 key，断线重连不会重复执行副作用操作。
- 工具执行权限仍由 OpenClaw 自身控制。

## 许可证

MIT
