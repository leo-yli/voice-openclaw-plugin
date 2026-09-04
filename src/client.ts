import WebSocket from "ws";
import { createLogger } from "./logger.js";
import { type MuseveVoiceConfig } from "./config.js";
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
  type PongPayload,
} from "./protocol.js";

const log = createLogger("client");
const CONNECTION_TIMEOUT_MS = 15_000;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "auth_failed";

export interface ClientEvents {
  onEvent: (event: XvcEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onTransportActivity?: () => void;
  onControlEvent?: (event: XvcEvent) => void;
  onBindingMissing?: () => void;
}

export class XvcClient {
  private config: MuseveVoiceConfig;
  private ws: WebSocket | null = null;
  private reconnect: ReconnectManager;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalMs = 15000;
  private missedPongs = 0;
  private maxMissedPongs = 3;
  private status: ConnectionStatus = "disconnected";
  private events: ClientEvents;
  private reconnectDisabled = false;
  private connectionGeneration = 0;
  private instanceId: string | null;
  private bindingStore: BindingStore;

  constructor(
    config: MuseveVoiceConfig,
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
    if (this.reconnectDisabled) {
      log.info("Reconnect disabled, skipping connect");
      return;
    }

    // Guard against duplicate timers/close events creating multiple sockets.
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.reconnect.cancel();
    this.setStatus("connecting");
    const generation = ++this.connectionGeneration;
    try {
      const ws = new WebSocket(this.config.serverUrl);
      this.ws = ws;
      this.startConnectionTimeout(ws, generation);
      ws.on("open", () => this.handleOpen(ws, generation));
      ws.on("message", (data) => {
        if (this.isCurrentSocket(ws, generation)) this.handleMessage(data.toString());
      });
      ws.on("pong", () => {
        if (this.isCurrentSocket(ws, generation)) this.markTransportAlive();
      });
      ws.on("close", (code, reason) => this.handleClose(ws, generation, code, reason.toString()));
      ws.on("error", (err) => {
        if (this.isCurrentSocket(ws, generation)) this.handleError(err);
      });
    } catch (err) {
      log.error("Failed to create WebSocket", err);
      this.ws = null;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  send(event: XvcEvent): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send, WebSocket not open");
      return;
    }
    ws.send(JSON.stringify(event));
  }

  disableReconnect(): void {
    this.reconnectDisabled = true;
    this.reconnect.cancel();
  }

  /** 测试用：直接派发一个 control_event，跳过 ws 层 */
  dispatchControlEvent(event: XvcEvent): void {
    this.events.onControlEvent?.(event);
  }

  disconnect(): void {
    this.disableReconnect();
    this.stopHeartbeat();
    this.stopConnectionTimeout();
    const ws = this.ws;
    this.ws = null;
    this.connectionGeneration++;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close(1000, "client disconnect");
    }
    this.setStatus("disconnected");
  }

  private isCurrentSocket(ws: WebSocket, generation: number): boolean {
    return this.ws === ws && this.connectionGeneration === generation;
  }

  private handleOpen(ws: WebSocket, generation: number): void {
    if (!this.isCurrentSocket(ws, generation)) return;
    log.info("WebSocket connected");
    if (this.reconnect.shouldResume) {
      this.sendResume(ws, generation).catch((err) => log.error("sendResume failed", err));
    } else {
      this.sendConnect(ws, generation).catch((err) => log.error("sendConnect failed", err));
    }
  }

  private async sendConnect(ws: WebSocket, generation: number): Promise<void> {
    const binding = await this.bindingStore.read();
    if (!binding) {
      log.error("No binding available, cannot connect");
      this.setStatus("auth_failed");
      return;
    }
    if (!this.isCurrentSocket(ws, generation) || ws.readyState !== WebSocket.OPEN) return;
    this.instanceId = binding.instanceId;

    const payload: ConnectPayload = {
      protocol_version: 1,
      client: {
        kind: "openclaw",
        plugin: "@museve/voice-openclaw-plugin",
        plugin_version: "2026.5.16",
        instance_id: binding.instanceId,
        device_name: binding.deviceLabel ?? "OpenClaw Instance",
      },
      channel: "museve_voice",
      auth: { token: binding.token },
      capabilities: [
        "text_message",
        "streaming_reply",
        "confirmation",
        "background_notification",
        "voice.user_turn",
        "voice_interrupt",
        "voice.interrupt",
        "voice.cancel_request",
        "delivery_ack",
      ],
    };
    ws.send(JSON.stringify(createEvent("connect", payload)));
  }

  private async sendResume(ws: WebSocket, generation: number): Promise<void> {
    const binding = await this.bindingStore.read();
    if (!binding) {
      this.setStatus("auth_failed");
      return;
    }
    if (!this.isCurrentSocket(ws, generation) || ws.readyState !== WebSocket.OPEN) return;
    const payload: ResumePayload = {
      connection_id: this.reconnect.connectionId!,
      last_event_id: this.reconnect.lastEventId!,
      auth: { token: binding.token },
    };
    ws.send(JSON.stringify(createEvent("resume", payload)));
  }

  private handleMessage(raw: string): void {
    const event = parseEvent(raw);
    if (!event) {
      log.warn("Received malformed message, skipping");
      return;
    }

    this.reconnect.recordEventId(event.event_id);
    this.markTransportAlive();

    switch (event.type) {
      case "connected": {
        const payload = event.payload as ConnectedPayload;
        this.reconnect.recordConnectionId(payload.connection_id);
        this.heartbeatIntervalMs = payload.heartbeat_interval_ms;
        this.stopConnectionTimeout();
        this.reconnect.reset();
        this.startHeartbeat();
        this.setStatus("connected");
        log.info(`Authenticated, connection_id=${payload.connection_id}`);
        break;
      }
      case "resumed": {
        this.stopConnectionTimeout();
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
      case "ping": {
        const payload = event.payload as PingPayload;
        const pong: PongPayload = { ts: payload.ts ?? Date.now() };
        this.send(createEvent("pong", pong));
        return;
      }
      case "error": {
        this.handleErrorEvent(event.payload as { code: string; message: string; reason?: string });
        return; // 不向 onEvent 广播 error
      }
      // control_event：不走业务 dispatchEvent，直接路由给上层
      case "binding_revoked":
      case "token_rotated_notify":
      case "binding_metadata_updated":
      case "server_announcement": {
        this.events.onControlEvent?.(event);
        return; // 不再调用通用 events.onEvent
      }
      default:
        break;
    }

    this.events.onEvent(event);
  }

  private handleErrorEvent(errPayload: {
    code: string;
    message: string;
    reason?: string;
  }): void {
    if (errPayload.code === "AUTH_FAILED") {
      const reason = errPayload.reason ?? "token_invalid";
      log.error(`Authentication failed: reason=${reason}, message=${errPayload.message}`);

      if (this.shouldFallbackToFreshConnect(reason, errPayload.message)) {
        this.retryFreshConnectAfterResumeFailure(errPayload.message);
        return;
      }

      this.setStatus("auth_failed");
      this.disableReconnect();

      if (reason === "instance_mismatch") {
        // 上抛为 control event，触发上层风控（清 binding + 告警）
        const synth = createEvent("binding_revoked", {
          binding_id: "unknown",
          reason: "suspicious_activity",
          revoked_at: new Date().toISOString(),
          message: errPayload.message,
        });
        this.events.onControlEvent?.(synth);
      } else if (reason === "binding_revoked" || reason === "token_invalid") {
        const synth = createEvent("binding_revoked", {
          binding_id: "unknown",
          reason: "user_unbound",
          revoked_at: new Date().toISOString(),
          message: errPayload.message,
        });
        this.events.onControlEvent?.(synth);
      }

      this.disconnect();
      return;
    }
    log.error(`Server error: ${errPayload.code} - ${errPayload.message}`);
  }

  private shouldFallbackToFreshConnect(reason: string, message: string): boolean {
    if (!this.reconnect.shouldResume) return false;
    const normalized = message.toLowerCase();
    return (
      reason === "protocol_error" ||
      reason === "resume_failed" ||
      normalized.includes("first frame must be connect") ||
      normalized.includes("resume")
    );
  }

  private retryFreshConnectAfterResumeFailure(message: string): void {
    log.warn(`Resume rejected by server, falling back to fresh connect: ${message}`);
    this.forceReconnect("resume rejected", true);
  }

  private handleClose(ws: WebSocket, generation: number, code: number, reason: string): void {
    if (!this.isCurrentSocket(ws, generation)) return;
    log.info(`WebSocket closed: code=${code} reason=${reason}`);
    this.stopHeartbeat();
    this.stopConnectionTimeout();
    this.ws = null;

    if (this.status === "auth_failed") return;
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private handleError(err: Error): void {
    log.error("WebSocket error", err);
    this.forceReconnect(`websocket error: ${err.message}`);
  }

  private markTransportAlive(): void {
    this.missedPongs = 0;
    this.events.onTransportActivity?.();
  }

  private startConnectionTimeout(ws: WebSocket, generation: number): void {
    this.stopConnectionTimeout();
    this.connectionTimeout = setTimeout(() => {
      if (!this.isCurrentSocket(ws, generation) || this.status === "connected") return;
      log.warn(`Connection/authentication timed out after ${CONNECTION_TIMEOUT_MS}ms`);
      this.forceReconnect("connection timeout");
    }, CONNECTION_TIMEOUT_MS);
  }

  private stopConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;
    this.heartbeatInterval = setInterval(() => {
      this.missedPongs++;
      if (this.missedPongs > this.maxMissedPongs) {
        log.warn(`Missed ${this.missedPongs} pongs, reconnecting`);
        this.forceReconnect("heartbeat timeout");
        return;
      }
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        this.forceReconnect("heartbeat found socket not open");
        return;
      }
      // Native WebSocket ping detects half-open TCP connections; the XVC ping
      // remains for servers that track application-level heartbeat activity.
      ws.ping();
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

  private forceReconnect(reason: string, clearSession = false): void {
    if (clearSession) this.reconnect.clearSession();
    this.stopHeartbeat();
    this.stopConnectionTimeout();
    const ws = this.ws;
    this.ws = null;
    this.connectionGeneration++;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      // terminate() guarantees progress when the peer has left a half-open socket.
      ws.terminate();
    }
    if (this.status !== "auth_failed") this.setStatus("disconnected");
    log.info(`Forcing reconnect: ${reason}`);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectDisabled) {
      log.info("Reconnect disabled, skipping");
      return;
    }
    if (this.reconnect.hasScheduledReconnect) {
      log.debug("Reconnect already scheduled, skipping duplicate schedule");
      return;
    }
    const delay = this.reconnect.nextDelay();
    log.info(`Scheduling reconnect in ${delay}ms`);
    this.reconnect.schedule(() => {
      this.connect().catch((err) => {
        log.error("Reconnect attempt failed", err);
        this.scheduleReconnect();
      });
    });
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.events.onStatusChange(status);
    }
  }
}
