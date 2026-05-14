import WebSocket from "ws";
import { createEvent, parseEvent, type ConnectedPayload } from "./src/protocol.js";
import { createLogger } from "./src/logger.js";

const log = createLogger("setup");

export interface SetupResult {
  success: boolean;
  token?: string;
  error?: string;
}

export async function verifyToken(
  serverUrl: string,
  token: string,
  timeoutMs: number = 10000
): Promise<SetupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: "Connection timeout" });
    }, timeoutMs);

    const ws = new WebSocket(serverUrl);

    ws.on("open", () => {
      const connectEvent = createEvent("connect", {
        protocol_version: 1,
        client: {
          kind: "openclaw",
          plugin: "@xalgo/voice-openclaw-plugin",
          plugin_version: "0.1.0",
          instance_id: "setup_verify",
          device_name: "Setup Verification",
        },
        channel: "xalgo_voice",
        auth: { token },
        capabilities: ["text_message"],
      });
      ws.send(JSON.stringify(connectEvent));
    });

    ws.on("message", (data) => {
      const event = parseEvent(data.toString());
      if (!event) return;

      if (event.type === "connected") {
        clearTimeout(timer);
        ws.close();
        resolve({ success: true, token });
      } else if (event.type === "error") {
        clearTimeout(timer);
        ws.close();
        const payload = event.payload as { message: string };
        resolve({ success: false, error: payload.message || "Authentication failed" });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
}

export default async function setup(context: {
  prompt: (question: string) => Promise<string>;
  writeConfig: (key: string, value: unknown) => Promise<void>;
  log: (msg: string) => void;
}): Promise<void> {
  context.log("Xalgo Voice Channel 配置向导");
  context.log("────────────────────────────");
  context.log("");

  const token = await context.prompt("请输入 Xalgo Channel Token (从 Xalgo App 获取):");
  if (!token.trim()) {
    context.log("错误: Token 不能为空");
    return;
  }

  const serverUrl = await context.prompt(
    "Channel Server 地址 (默认: wss://channel.xalgo.ai/openclaw/connect):"
  );
  const url = serverUrl.trim() || "wss://channel.xalgo.ai/openclaw/connect";

  context.log("");
  context.log("正在验证连接...");

  const result = await verifyToken(url, token.trim());

  if (result.success) {
    await context.writeConfig("channels.xalgoVoice.enabled", true);
    await context.writeConfig("channels.xalgoVoice.token", token.trim());
    await context.writeConfig("channels.xalgoVoice.serverUrl", url);
    context.log("✓ 连接验证成功，配置已保存");
  } else {
    context.log(`✗ 连接失败: ${result.error}`);
    context.log("请检查 Token 是否正确，或联系 Xalgo 支持。");
  }
}
