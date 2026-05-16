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

## 快速开始（5 分钟接入）

> **前置要求**：OpenClaw `>= 2026.3.28`、Node.js `>= 20`（推荐 Node 22+，可去掉 JSON import 的 experimental warning）

三步走：**装插件** → **绑定** → **重启**。

### 1️⃣ 装插件

#### 方式 A（推荐 ✅）：从 npm 仓库直接装

最干净，一条命令搞定。

```bash
openclaw plugins install @xalgo/voice-openclaw-plugin
```

> ⏳ **包发布在即**——发布完成前请用方式 B。后面所有命令保持一致。

#### 方式 B：从 GitHub clone 安装

适合 npm 包未发布、需要锁定到具体 commit、或者本地有改动要调试的场景。

```bash
cd ~
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin
npm install                  # prepare 钩子会自动 tsc 编译出 dist/
openclaw plugins install .   # ★ 是 . 不是 ./dist，OpenClaw 要读 package.json
```

> ⚠️ **`openclaw plugins install` 不接受 URL 形式**（实测会报 `unsupported npm spec: URLs are not allowed`），所以不能 `openclaw plugins install git+https://...`。必须先在本地 clone 再 install `.`。

### 2️⃣ 跑 OpenClaw 自带的 channel 配置向导

```bash
openclaw channels add
# 选择 "Xalgo Voice (语音)" → 按提示输入 Xalgo App 给的 8 位绑定码
# ↑ 向导会自动调 exchange 接口换长期 Channel Token，写入 OpenClaw 配置
```

绑定码哪来？打开 Xalgo App，点击「连接 OpenClaw」，App 显示一个 **8 位绑定码**（5 分钟内有效）。

> 这是 OpenClaw 推荐的标准 setup 路径——和企业微信 (`@wecom/wecom-openclaw-plugin`) 用同样机制（[`ChannelSetupWizard`](https://github.com/WecomTeam/wecom-openclaw-plugin/blob/main/src/onboarding.ts)）。

### 3️⃣ 重启 OpenClaw 让 channel 加载新配置

```bash
openclaw gateway restart      # 或对应的 systemctl / supervisor 命令
```

启动 log 里应该看到：

```
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] WebSocket connected
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] Authenticated, connection_id=...
```

✅ 接入完成。对 Xalgo 眼镜说话即可触发 OpenClaw Agent。

---

## 验证 / 排错

| 检查 | 命令 | 期望 |
|---|---|---|
| 插件是否被识别 | `openclaw plugins list \| grep xalgo` | 看到 `xalgo_voice` 一行 |
| 插件细节 | `openclaw plugins inspect xalgo_voice` | `Shape: plain-capability` + `Capabilities: channel: xalgo_voice` |
| 配置是否写入 | `cat ~/.openclaw/openclaw.json \| grep -A 5 xalgo_voice` | 看到 `token` 等字段 |

常见错误：

- **`plugin already exists` 在 install 时报**：之前装过，先 `rm -rf ~/.openclaw/extensions/xalgo_voice` 再 install
- **`Also not a valid hook pack: package.json missing openclaw.hooks`**：fallback 解析尝试失败的无害提示，可忽略
- **`Plugin manifest id "xalgo_voice" differs from npm package name`**：cosmetic 警告，不影响功能（OpenClaw 用 manifest id 作 config key）

---

## 升级

#### 如果用方式 A（npm）装的

```bash
openclaw plugins update @xalgo/voice-openclaw-plugin    # 或重新 install 同名包
openclaw gateway restart
```

#### 如果用方式 B（GitHub clone）装的

```bash
cd ~/voice-openclaw-plugin
git pull
npm install                                    # prepare 钩子重 build
rm -rf ~/.openclaw/extensions/xalgo_voice      # ★ OpenClaw 不会自动覆盖，必须先删
openclaw plugins install .
openclaw gateway restart
```

---

## 备用安装方式

> 99% 场景下用上面「快速开始」的方式 A / B 就行。下面是特殊环境的备选。

### C. npm pack tarball（无 git 但能 scp 的环境）

```bash
# 开发机 / CI 上：
cd voice-openclaw-plugin && npm install && npm pack
# → 生成 xalgo-voice-openclaw-plugin-2026.5.16.tgz

# OpenClaw 主机上：
openclaw plugins install /path/to/xalgo-voice-openclaw-plugin-2026.5.16.tgz
```

### D. 离线手动复制到 extensions 目录

只在完全不能跑 `openclaw plugins install` 时用：

```bash
# 在能联网的机器：build 并打包
cd voice-openclaw-plugin && npm install && npm run build
npm install --omit=dev
tar czf plugin.tar.gz dist node_modules endpoints.json openclaw.plugin.json package.json README.md

# 推到 OpenClaw 主机并解压
scp plugin.tar.gz root@<host>:/tmp/
ssh root@<host>
mkdir -p ~/.openclaw/extensions/xalgo_voice
tar xzf /tmp/plugin.tar.gz -C ~/.openclaw/extensions/xalgo_voice
openclaw gateway restart
```

⚠️ 这种方式 OpenClaw 会标记为 `loaded without install/load-path provenance`，**需要在 `~/.openclaw/openclaw.json` 的 `plugins.allow` 里手动加上 `xalgo_voice`** 才能被信任执行。

**目前未发布到 npm**，暂用上面其它方式。

---

## 重新绑定 / 解绑 / 切账号

绑定后想换 Xalgo 账号、或者怀疑 token 泄漏想 rotate：

### 方式 A：`openclaw channels add` 再走一次

向导会检测到已有绑定，提示「保持/重新绑定/解绑」三选一。

### 方式 B：独立 CLI `xalgo-bind`（fallback）

如果你 OpenClaw 版本不支持 `channels add` 命令、或者需要脚本化操作：

```bash
node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js
```

> 💡 建议在 `~/.bashrc` 里加：
> ```bash
> alias xalgo-bind='node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js'
> ```
> 之后绑定/解绑都是一条 `xalgo-bind`。

### 方式 C：Xalgo App 端解绑

在 Xalgo App「设备列表」点击对应 OpenClaw → 移除/Rotate Token。App 操作后服务端会通过 WebSocket 推 `binding_revoked` / `token_rotated_notify`，插件秒级感知，自动清空 / 更换本地凭据。

---

## 高级：手动编辑配置

绑定向导写入的字段都在 `~/.openclaw/openclaw.json` 的 `channels.xalgo_voice.*` 下。**通常不需要手动改**，但如果要切换 API 端点或调试，可以参考下面的完整 schema：

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

> 💡 **默认端点的 source of truth**：`serverUrl` / `apiBaseUrl` 的默认值在项目根的 `endpoints.json`。开发者切换测试/生产环境只需改这一个文件。
> 终端用户**不要**改 `node_modules` 里的 `endpoints.json`——请通过上面 OpenClaw 配置覆盖 `channels.xalgo_voice.serverUrl` / `apiBaseUrl`。

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用插件（绑定向导成功后自动设为 true） |
| `serverUrl` | string | `wss://asr-test.jlpay.com/openclaw/connect` | WebSocket Channel Server 地址（默认值来自 `endpoints.json`） |
| `apiBaseUrl` | string | `https://asr-test.jlpay.com` | REST API base（用于 exchange/rotate/unbind；默认值来自 `endpoints.json`） |
| `token` | string | (绑定向导自动写入) | Xalgo Channel Token，请勿手动修改 |
| `instanceId` | string | (绑定向导自动生成 UUID v4) | 插件实例 ID，作为设备指纹参与鉴权 |
| `boundUserId` / `boundUserName` / `boundAt` | string | (绑定向导自动写入) | 仅供展示用 |
| `deviceLabel` | string | `OpenClaw on <hostname>` | 设备标签，在 Xalgo App 侧显示 |
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
