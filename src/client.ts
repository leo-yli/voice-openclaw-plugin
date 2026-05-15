import WebSocket from "ws";
import { createLogger } from "./logger.js";
import { type XalgoVoiceConfig } from "./config.js";
import { ReconnectManager } from "./reconnect.js";
import type { BindingStore } from "./binding-store.js";
import {
  parseEvent,
  createEvent,
  type XvcEvent,
  type ConnectPayload,
  type ConnectedPayload,
  type ResumePayload,
  type PingPayload,
} from "./protocol.js";

const log = createLogger("client");

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "auth_failed";

export interface ClientEvents {
  onEvent: (event: XvcEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
}

export class XvcClient {
  private config: XalgoVoiceConfig;
  private ws: WebSocket | null = null;
  private reconnect: ReconnectManager;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs = 15000;
  private missedPongs = 0;
  private maxMissedPongs = 3;
  private status: ConnectionStatus = "disconnected";
  private events: ClientEvents;
  private instanceId: string | null;
  private bindingStore: BindingStore;

  constructor(
    config: XalgoVoiceConfig,
    events: ClientEvents,
    bindingStore: BindingStore
  ) {
    this.config = config;
    this.events = events;
    this.reconnect = new ReconnectManager(config.reconnect);
    this.instanceId = null;
    this.bindingStore = bindingStore;
  }

  async getInstanceId(): Promise<string | null> {
    if (this.instanceId) return this.instanceId;
    const binding = await this.bindingStore.read();
    if (binding) {
      this.instanceId = binding.instanceId;
      return this.instanceId;
    }
    return null;
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (this.status === "connecting" || this.status === "connected") return;
    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.config.serverUrl);
      this.ws.on("open", () => this.handleOpen());
      this.ws.on("message", (data) => this.handleMessage(data.toString()));
      this.ws.on("close", (code, reason) => this.handleClose(code, reason.toString()));
      this.ws.on("error", (err) => this.handleError(err));
    } catch (err) {
      log.error("Failed to create WebSocket", err);
      this.scheduleReconnect();
    }
  }

  send(event: XvcEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send, WebSocket not open");
      return;
    }
    this.ws.send(JSON.stringify(event));
  }

  disconnect(): void {
    this.reconnect.cancel();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  private handleOpen(): void {
    log.info("WebSocket connected");
    if (this.reconnect.shouldResume) {
      this.sendResume().catch((err) => log.error("sendResume failed", err));
    } else {
      this.sendConnect().catch((err) => log.error("sendConnect failed", err));
    }
  }

  private async sendConnect(): Promise<void> {
    const binding = await this.bindingStore.read();
    if (!binding) {
      log.error("No binding available, cannot connect");
      this.setStatus("auth_failed");
      return;
    }
    this.instanceId = binding.instanceId;

    const payload: ConnectPayload = {
      protocol_version: 1,
      client: {
        kind: "openclaw",
        plugin: "@xalgo/voice-openclaw-plugin",
        plugin_version: "0.1.0",
        instance_id: binding.instanceId,
        device_name: binding.deviceLabel ?? "OpenClaw Instance",
      },
      channel: "xalgo_voice",
      auth: { token: binding.token },
      capabilities: [
        "text_message",
        "streaming_reply",
        "confirmation",
        "background_notification",
        "voice_interrupt",
        "delivery_ack",
      ],
    };
    this.send(createEvent("connect", payload));
  }

  private async sendResume(): Promise<void> {
    const binding = await this.bindingStore.read();
    if (!binding) {
      this.setStatus("auth_failed");
      return;
    }
    const payload: ResumePayload = {
      connection_id: this.reconnect.connectionId!,
      last_event_id: this.reconnect.lastEventId!,
      auth: { token: binding.token },
    };
    this.send(createEvent("resume", payload));
  }

  private handleMessage(raw: string): void {
    const event = parseEvent(raw);
    if (!event) {
      log.warn("Received malformed message, skipping");
      return;
    }

    this.reconnect.recordEventId(event.event_id);

    switch (event.type) {
      case "connected": {
        const payload = event.payload as ConnectedPayload;
        this.reconnect.recordConnectionId(payload.connection_id);
        this.heartbeatIntervalMs = payload.heartbeat_interval_ms;
        this.reconnect.reset();
        this.startHeartbeat();
        this.setStatus("connected");
        log.info(`Authenticated, connection_id=${payload.connection_id}`);
        break;
      }
      case "resumed": {
        this.reconnect.reset();
        this.startHeartbeat();
        this.setStatus("connected");
        log.info("Session resumed");
        break;
      }
      case "pong": {
        this.missedPongs = 0;
        break;
      }
      case "error": {
        const errPayload = event.payload as { code: string; message: string };
        if (errPayload.code === "AUTH_FAILED") {
          log.error("Authentication failed, stopping reconnect");
          this.setStatus("auth_failed");
          this.disconnect();
          return;
        }
        log.error(`Server error: ${errPayload.code} - ${errPayload.message}`);
        break;
      }
      default:
        break;
    }

    this.events.onEvent(event);
  }

  private handleClose(code: number, reason: string): void {
    log.info(`WebSocket closed: code=${code} reason=${reason}`);
    this.stopHeartbeat();
    this.ws = null;

    if (this.status === "auth_failed") return;
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private handleError(err: Error): void {
    log.error("WebSocket error", err);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;
    this.heartbeatInterval = setInterval(() => {
      this.missedPongs++;
      if (this.missedPongs > this.maxMissedPongs) {
        log.warn(`Missed ${this.missedPongs} pongs, reconnecting`);
        this.ws?.close(4000, "heartbeat timeout");
        return;
      }
      const ping: PingPayload = { ts: Date.now() };
      this.send(createEvent("ping", ping));
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    log.info(`Scheduling reconnect in ${this.reconnect.nextDelay()}ms`);
    this.reconnect.schedule(() => this.connect());
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.events.onStatusChange(status);
    }
  }
}
