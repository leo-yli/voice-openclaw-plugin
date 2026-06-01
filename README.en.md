# @xalgo/voice-openclaw-plugin

Xalgo Voice Channel plugin for controlling an OpenClaw Agent in real time through Xalgo glasses voice input.

English | [中文](./README.md)

---

@xalgo/voice-openclaw-plugin is an OpenClaw Channel plugin that lets users control their OpenClaw Agent in real time through voice input from Xalgo glasses. The plugin connects outbound to the Xalgo Voice Channel Server as a WebSocket client, so OpenClaw does not need to expose a public port.

## How It Works

```text
Xalgo Glasses -> Pupa Cloud (ASR/TTS) -> Xalgo Voice Channel Server
                                                ^ v WebSocket
                                          voice-openclaw-plugin
                                                |
                                          OpenClaw Agent
```

- The plugin actively connects to the Xalgo Channel Server as a WebSocket client.
- OpenClaw does not need a public inbound endpoint, which makes the plugin suitable for private network deployments.
- Speech recognition (ASR) and speech synthesis (TTS) are handled by Xalgo Pupa Cloud. The plugin handles protocol conversion and message forwarding.

## Quick Start

Requirements:

- OpenClaw `>= 2026.3.28`
- Node.js `>= 20`; Node.js 22+ is recommended to avoid the JSON import experimental warning

Setup flow: install the plugin -> bind your Xalgo account -> restart OpenClaw.

### 1. Install the Plugin

Choose one installation method based on your environment.

#### Option A: Install from npm

```bash
openclaw plugins install @xalgo/voice-openclaw-plugin
```

If the npm package has not been published yet, use Option B first. After the package is installed, the binding and runtime commands are the same.

#### Option B: Install from a GitHub clone

Use this when the npm package is not available yet, when you need a specific commit, or when you are debugging local changes.

```bash
cd ~
git clone https://github.com/leo-yli/voice-openclaw-plugin.git
cd voice-openclaw-plugin
npm install
openclaw plugins install .
```

`openclaw plugins install` does not accept URL specs such as `openclaw plugins install git+https://...`. Clone the repository locally first, then install `.` so OpenClaw can read the local `package.json`.

#### Option C: Distribute a tarball

Use this when your development machine or CI has network access, but the OpenClaw host cannot install npm packages directly.

```bash
# On the development machine or CI:
cd voice-openclaw-plugin
npm install
npm pack
# Produces xalgo-voice-openclaw-plugin-2026.5.16.tgz

# On the OpenClaw host:
openclaw plugins install /path/to/xalgo-voice-openclaw-plugin-2026.5.16.tgz
```

#### Option D: Offline copy into the extensions directory

Use this only when `openclaw plugins install` cannot be run at all.

```bash
# On a machine with network access, build and package production dependencies:
cd voice-openclaw-plugin
npm install
npm run build
npm install --omit=dev
tar czf plugin.tar.gz dist node_modules endpoints.json openclaw.plugin.json package.json README.md README.en.md

# Copy to the OpenClaw host and extract:
scp plugin.tar.gz root@<host>:/tmp/
ssh root@<host>
mkdir -p ~/.openclaw/extensions/xalgo_voice
tar xzf /tmp/plugin.tar.gz -C ~/.openclaw/extensions/xalgo_voice
```

With this method, OpenClaw may mark the plugin as `loaded without install/load-path provenance`. Add `xalgo_voice` to `plugins.allow` in `~/.openclaw/openclaw.json` so OpenClaw trusts and runs the plugin.

### 2. Run the Channel Setup Wizard

```bash
openclaw channels add
```

Choose `Xalgo Voice (语音)` in the wizard, then enter the 8-digit binding code shown in the Xalgo App. The wizard exchanges the short-lived code for a long-lived Channel Token and writes it to the OpenClaw config.

To get a binding code, open the Xalgo App and tap "Connect OpenClaw". The App displays an 8-digit code that is valid for 5 minutes.

### 3. Restart OpenClaw

```bash
openclaw gateway restart
# Or use the corresponding systemctl / supervisor command
```

The startup logs should include lines similar to:

```text
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] WebSocket connected
[plugins] [@xalgo/voice-openclaw-plugin 2026.5.16] Authenticated, connection_id=...
```

You can also verify the plugin with:

```bash
openclaw plugins list | grep xalgo
openclaw plugins inspect xalgo_voice
```

Once the `xalgo_voice` channel is loaded, speaking to Xalgo glasses can trigger the OpenClaw Agent.

## Upgrade

### npm installation

```bash
openclaw plugins update @xalgo/voice-openclaw-plugin
openclaw gateway restart
```

You can also reinstall the package with the same name.

### GitHub clone installation

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

Do not delete `~/.openclaw/extensions/xalgo_voice` before running `openclaw plugins uninstall xalgo_voice`. Deleting the extension directory directly can leave stale config and cause `unknown channel id` or `plugin not found` errors. If install reports `plugin already exists`, run the official uninstall first, remove the leftover directory, then install again.

## Rebind, Unbind, or Switch Accounts

Use one of the following methods when you need to switch Xalgo accounts or rotate a potentially exposed token.

### Option A: Run `openclaw channels add` again

The wizard detects the existing binding and lets you keep it, rebind it, or unbind it.

### Option B: Use the standalone `xalgo-bind` CLI

Use this if your OpenClaw version does not support `channels add`, or if you need a scriptable fallback:

```bash
node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js
```

Optionally add an alias to your shell config:

```bash
alias xalgo-bind='node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js'
```

Then use `xalgo-bind` for binding or unbinding.

### Option C: Unbind in the Xalgo App

In the Xalgo App device list, select the corresponding OpenClaw device, then remove it or rotate the token. The server sends `binding_revoked` or `token_rotated_notify` over WebSocket, and the plugin automatically clears or updates the local credentials.

## Manual Configuration

The setup wizard writes configuration under `channels.xalgo_voice.*` in `~/.openclaw/openclaw.json`. Manual edits are usually unnecessary. If you need to switch API endpoints or debug the plugin, use this schema as a reference:

```json
{
  "channels": {
    "xalgo_voice": {
      "enabled": true,
      "serverUrl": "wss://asr-test.jlpay.com/openclaw/connect",
      "apiBaseUrl": "https://asr-test.jlpay.com",
      "token": "<written by the setup wizard>",
      "instanceId": "<written by the setup wizard>",
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

The default `serverUrl` and `apiBaseUrl` come from `endpoints.json` at the repository root. Developers can switch test or production environments by changing that file. End users should not edit `endpoints.json` inside `node_modules`; override `channels.xalgo_voice.serverUrl` or `channels.xalgo_voice.apiBaseUrl` in the OpenClaw config instead.

### Configuration Reference

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | Whether the plugin is enabled. The setup wizard sets it to `true` after a successful binding. |
| `serverUrl` | string | `wss://asr-test.jlpay.com/openclaw/connect` | WebSocket Channel Server URL. |
| `apiBaseUrl` | string | `https://asr-test.jlpay.com` | REST API base URL for exchange, rotate, and unbind. |
| `token` | string | Written by the setup wizard | Xalgo Channel Token. Do not edit manually. |
| `instanceId` | string | UUID v4 generated by the setup wizard | Plugin instance ID used as part of the device fingerprint. |
| `boundUserId` / `boundUserName` / `boundAt` | string | Written by the setup wizard | Display-only binding metadata. |
| `deviceLabel` | string | `OpenClaw on <hostname>` | Device label shown in the Xalgo App. |
| `agentId` | string | `voice` | OpenClaw Agent ID. |
| `sessionPrefix` | string | `xalgo_voice` | Session ID prefix. |
| `streaming` | boolean | `true` | Whether streaming replies are enabled. |
| `replyMode` | string | `voice_first` | Reply mode: `voice_first` / `text_first` / `both`. |
| `riskPolicy.confirmExternalSend` | boolean | `true` | Whether outbound messages require confirmation. |
| `riskPolicy.confirmDangerousTools` | boolean | `true` | Whether dangerous tools require confirmation. |
| `riskPolicy.allowPureVoiceR3` | boolean | `false` | Whether R3 operations can be confirmed by voice only. |
| `reconnect.minDelayMs` | number | `1000` | Minimum reconnect delay in milliseconds. |
| `reconnect.maxDelayMs` | number | `30000` | Maximum reconnect delay in milliseconds. |
| `reconnect.resume` | boolean | `true` | Whether to attempt session resume after reconnecting. |

## Runtime Flow

### Basic voice interaction

1. The user speaks to Xalgo glasses.
2. Pupa Cloud performs ASR and sends text to the Channel Server.
3. The plugin receives the message and forwards it to the OpenClaw Agent.
4. The Agent processes the request and returns text.
5. The plugin sends the reply back to the Channel Server.
6. Pupa Cloud converts the reply to speech and plays it through the glasses.

### Streaming replies

When `streaming: true` is enabled, the Agent reply can be sent and played while it is still being generated, reducing perceived voice latency.

### Confirmation flow

When the Agent performs risky actions, the plugin requests user confirmation:

| Risk Level | Description | Confirmation |
| --- | --- | --- |
| R0 | Read-only queries | Execute directly |
| R1 | Low-risk writes | Execute and announce the result |
| R2 | External send or actions affecting others | Voice or phone confirmation |
| R3 | Delete, payment, or public publishing | Phone confirmation only by default |

### Voice interruption

Users can interrupt while the Agent is replying and issue a new instruction. The plugin will:

1. Stop the current playback.
2. Record what has already been played and what remains unplayed.
3. Send the new instruction to the Agent for continued processing.

## Development

```bash
npm install
npm run build
npm run dev
npm test
npm run lint
```

### Project Structure

```text
src/
├── channel.ts        # OpenClaw Channel adapter
├── client.ts         # WebSocket client
├── config.ts         # Config types and defaults
├── protocol.ts       # XVC protocol event types
├── inbound.ts        # Inbound message parsing (Xalgo -> OpenClaw)
├── outbound.ts       # Outbound message formatting (OpenClaw -> Xalgo)
├── streaming.ts      # Streaming reply management
├── confirmation.ts   # Confirmation state machine
├── interrupt.ts      # Voice interruption handling
├── delivery-ack.ts   # Delivery acknowledgement tracking
├── reconnect.ts      # Reconnect management
├── session.ts        # Session ID mapping
└── logger.ts         # Logging
```

## Security

- The plugin does not store the OpenClaw Gateway Token. It only stores the Xalgo Channel Token.
- All transport uses encrypted `wss://` connections.
- Tokens can be revoked or rotated at any time.
- Events include idempotency keys, so reconnect replay does not repeat side-effecting operations.
- Tool execution permissions are still enforced by OpenClaw itself.

## License

MIT
