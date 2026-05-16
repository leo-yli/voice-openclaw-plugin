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

> **要求**：Node.js ≥ 20（推荐 Node 22+，去除 JSON import 的 experimental warning）；OpenClaw 主机可访问 GitHub
>
> ⚠️ **`openclaw plugins install` 不支持任何 URL**（实测会报 `unsupported npm spec: URLs are not allowed`），仅接受 npm 包名或本地路径。所以 `git+https://...` 形式装不上，下面三种方式都先在 OpenClaw 主机上拉下来再装。

### 方式一：clone + 本地路径安装（当前推荐 ✅）

在 **OpenClaw 主机本机**上执行：

```bash
# 1. clone（建议放固定目录，避免后续路径变动）
cd ~
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin

# 2. 装依赖 + 编译（package.json 的 prepare 钩子会自动跑 tsc，
#    但首次还是显式跑一次更稳）
npm install
npm run build

# 3. 安装到 OpenClaw（注意是当前目录 . ，不是 ./dist；
#    OpenClaw 要读 package.json 里的 openclaw 字段做发现）
openclaw plugins install .
```

升级时（**关键：先删旧的，OpenClaw 不会自动覆盖**）：

```bash
cd ~/voice-openclaw-plugin
git pull
npm install   # 如有 dependencies 变化
npm run build

# 删除已存在的旧版本（用 plugin manifest id "xalgo_voice"，不是 npm 包名）
rm -rf ~/.openclaw/extensions/xalgo_voice

# 重新安装
openclaw plugins install .
```

> 💡 OpenClaw 用 `openclaw.plugin.json` 的 `id` 字段（即 `xalgo_voice`，snake_case）作为插件目录名 / config key，不是 npm 包名 `@xalgo/voice-openclaw-plugin`。卸载或操作目录时都用这个 id。

### 常见错误：`plugin already exists`

```
plugin already exists: /root/.openclaw/extensions/xalgo_voice (delete it first)
```

OpenClaw 拒绝覆盖已存在的同名插件，按上面"升级"流程先 `rm -rf` 再装即可。安装过程中可能还会看到：

```
Also not a valid hook pack: Error: package.json missing openclaw.hooks
```

这是 OpenClaw 把它当 hook pack 解析失败的 fallback 提示，无害，可忽略。

### 方式二：npm pack 后装 tarball（适合无 git 但有 tarball 的环境）

如果你的运维流程倾向于分发单个 `.tgz` 文件（比如 CI 产出后通过 scp 推到生产机）：

```bash
# 开发机/CI 上：打包
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin
npm install
npm pack                                # 生成 xalgo-voice-openclaw-plugin-2026.5.16.tgz

# 把 .tgz 拷到 OpenClaw 主机
scp xalgo-voice-openclaw-plugin-2026.5.16.tgz user@openclaw-host:/tmp/

# 在 OpenClaw 主机：装
openclaw plugins install /tmp/xalgo-voice-openclaw-plugin-2026.5.16.tgz
```

### 方式三：手动复制到 extensions 目录（离线 / 兜底）

OpenClaw 启动时会扫描 `~/.openclaw/extensions/<plugin-name>/` 自动加载。不走 `plugins install` 命令的离线方式：

```bash
# 1. 在能联网的机器上 clone + build
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin
npm install
npm run build

# 2. 整目录打包（必须含 dist/ 和 node_modules/runtime 依赖）
npm install --omit=dev               # 只保留 production 依赖
tar czf voice-openclaw-plugin.tar.gz \
    dist node_modules endpoints.json openclaw.plugin.json package.json README.md

# 3. 推到 OpenClaw 主机，解压到 extensions 目录
scp voice-openclaw-plugin.tar.gz root@openclaw-host:/tmp/
ssh root@openclaw-host
mkdir -p ~/.openclaw/extensions/voice-openclaw-plugin
cd ~/.openclaw/extensions/voice-openclaw-plugin
tar xzf /tmp/voice-openclaw-plugin.tar.gz

# 4. 重启 OpenClaw 让它扫到新插件
```

⚠️ 这种方式 OpenClaw 会把它标记为 **`loaded without install/load-path provenance`**（无安装来源记录），日志类似：

```
voice-openclaw-plugin: loaded without install/load-path provenance;
treat as untracked local code and pin trust via plugins.allow or install records
```

如需被信任执行，把插件名加到 `plugins.allow` 配置。建议**优先用方式一/二**，方式三只在真正没办法跑 `openclaw plugins install` 时用。

### 方式四：通过 npm 公共仓库（待发布后启用）

```bash
openclaw plugins install @xalgo/voice-openclaw-plugin
```

**目前未发布到 npm**，请暂用方式一。

### 验证安装

```bash
openclaw plugins list | grep xalgo-voice
```

应该看到 `@xalgo/voice-openclaw-plugin v2026.5.16`。OpenClaw 启动 log 里也应该出现：

```
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] ...
```

## 配置

### 1. 在 Xalgo App 生成绑定码

打开 Xalgo App，点击「连接 OpenClaw」，App 会显示一个 **8 位绑定码**（5 分钟内有效）。

### 2. 在 OpenClaw 运行配置向导

```bash
openclaw plugins setup xalgo-voice
```

向导会引导：

1. 输入 8 位绑定码（不区分大小写）
2. 输入 API Server 地址（默认值来自项目根 `endpoints.json`，**当前测试期：`https://asr-test.jlpay.com`**）
3. 显示要绑定到的 Xalgo 账号，确认 `[y/N]`
4. 自动写入配置文件并建立 WebSocket 连接

> 💡 **开发者切换默认端点**：所有默认端点统一存放在项目根 `endpoints.json`，切换测试/生产环境只需改这一个文件。
> 终端用户如需自定义，**不要**改 `node_modules` 里的 `endpoints.json`，请在 OpenClaw 配置中覆盖 `serverUrl` / `apiBaseUrl` 字段（参考下方"手动配置"示例）。

### 3. 设备管理

绑定成功后：

- 在 **Xalgo App → 设备列表** 可以查看已绑定的 OpenClaw、修改设备名、解绑、Rotate Token
- 在 **OpenClaw 终端** 重新运行 `openclaw plugins setup xalgo-voice` 可以选择「保持现状 / 重新绑定 / 解绑」

### 4. 安全说明

- Channel Token 与本地 `instance_id` 双因子鉴权：Token 即使被复制到另一台机器也无法使用
- App 端主动解绑后，插件秒级感知并自动清空本地凭据
- 5 分钟内绑定码累计验证失败 ≥5 次即作废

### 5. 手动配置（高级）

绑定向导会自动写入以下配置到 `openclaw.json`。如有特殊需要也可手动调整：

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

## 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用插件 |
| `serverUrl` | string | `wss://asr-test.jlpay.com/openclaw/connect` | Channel Server 地址（测试期） |
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
