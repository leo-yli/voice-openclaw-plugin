import { WebSocketServer, WebSocket } from "ws";
import { createEvent, type XvcEvent, type ConnectedPayload, type BindingRevokedPayload } from "../../src/protocol.js";

export interface MockServerOptions {
  port?: number;
  token?: string;
  heartbeatIntervalMs?: number;
}

export class MockXalgoServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private token: string;
  private heartbeatIntervalMs: number;
  private receivedEvents: XvcEvent[] = [];
  private port: number;

  constructor(opts: MockServerOptions = {}) {
    this.port = opts.port ?? 0;
    this.token = opts.token ?? "test_token";
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 5000;
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
      this.wss.on("listening", () => {
        const addr = this.wss!.address();
        const port = typeof addr === "object" ? addr.port : this.port;
        this.port = port;
        resolve(port);
      });

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);
        ws.on("message", (data) => this.handleMessage(ws, data.toString()));
        ws.on("close", () => this.clients.delete(ws));
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getUrl(): string {
    return `ws://localhost:${this.port}`;
  }

  getReceivedEvents(): XvcEvent[] {
    return [...this.receivedEvents];
  }

  sendToAll(event: XvcEvent): void {
    const raw = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  sendInboundMessage(text: string, userId: string = "u123"): void {
    this.sendToAll(createEvent("inbound_message", {
      message_id: `msg_${Date.now()}`,
      session_id: "voice_session_test",
      agent_binding_id: "agent_binding_test",
      chat_id: `xalgo:user:${userId}`,
      chat_type: "direct",
      sender: { id: userId, name: "Test User" },
      text,
      metadata: { input_type: "voice", language: "zh-CN", asr_confidence: 0.95 },
    }));
  }

  sendVoiceCancelRequest(overrides: Record<string, unknown> = {}): void {
    this.sendToAll(createEvent("voice.cancel_request", {
      session_id: "voice_session_test",
      agent_binding_id: "agent_binding_test",
      utterance_id: `utt_${Date.now()}`,
      reason: "user_voice_cancel",
      user_text: "Never mind, cancel that task.",
      text: "Never mind, cancel that task.",
      turn_state: "CANCEL",
      metadata: { input_type: "voice" },
      ...overrides,
    }));
  }

  pushBindingRevoked(
    bindingId: string = "b_test",
    reason: BindingRevokedPayload["reason"] = "user_unbound"
  ): void {
    this.sendToAll(
      createEvent("binding_revoked", {
        binding_id: bindingId,
        reason,
        revoked_at: new Date().toISOString(),
      })
    );
  }

  pushTokenRotatedNotify(bindingId: string = "b_test"): void {
    this.sendToAll(
      createEvent("token_rotated_notify", {
        binding_id: bindingId,
        request_id: `req_${Date.now()}`,
        initiated_by: "user",
        grace_period_sec: 60,
      })
    );
  }

  closeConnection(code: number = 1000, reason: string = "test close"): void {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code, reason);
      }
    }
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let event: XvcEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    this.receivedEvents.push(event);

    if (event.type === "connect") {
      const payload = event.payload as { auth: { token: string } };
      if (payload.auth.token === this.token) {
        const connected: ConnectedPayload = {
          connection_id: `conn_${Date.now()}`,
          user_id: "xalgo_user_test",
          heartbeat_interval_ms: this.heartbeatIntervalMs,
          server_capabilities: ["asr_final", "tts_playback", "duplex_interrupt"],
        };
        ws.send(JSON.stringify(createEvent("connected", connected)));
      } else {
        ws.send(JSON.stringify(createEvent("error", { code: "AUTH_FAILED", message: "Invalid token" })));
      }
    } else if (event.type === "ping") {
      ws.send(JSON.stringify(createEvent("pong", { ts: Date.now() })));
    } else if (event.type === "resume") {
      ws.send(JSON.stringify(createEvent("resumed", {})));
    }
  }
}
