# Museve Voice OpenClaw Channel Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full OpenClaw Channel Plugin that connects Museve voice devices to OpenClaw agents via WebSocket, supporting streaming replies, voice confirmation, and duplex interrupt.

**Architecture:** Three-layer design — Channel Layer (OpenClaw plugin interface), Protocol Layer (XVC event dispatch, confirmation, interrupt, streaming), Transport Layer (WebSocket client with heartbeat and reconnect). Single WebSocket connection carries both inbound and outbound messages.

**Tech Stack:** TypeScript, Node.js, ws ^8.18.0, vitest ^2.0.0, tsc

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts, npm package metadata |
| `tsconfig.json` | TypeScript config (ESM, strict) |
| `openclaw.plugin.json` | OpenClaw plugin manifest |
| `index.ts` | Entry: registers channel plugin with OpenClaw |
| `setup-entry.ts` | Binding code setup wizard for first-time config |
| `src/logger.ts` | Thin logging abstraction |
| `src/config.ts` | `MuseveVoiceConfig` type + defaults + validation |
| `src/protocol.ts` | All XVC event type definitions + event envelope |
| `src/session.ts` | Session ID mapping (direct/room) |
| `src/client.ts` | WebSocket client: connect, send, receive, ping/pong |
| `src/reconnect.ts` | Exponential backoff + resume logic |
| `src/inbound.ts` | Parse `inbound_message` → OpenClaw `InboundMessage` |
| `src/outbound.ts` | Format OpenClaw reply → `outbound_message` / `outbound_delta` |
| `src/streaming.ts` | Manage outbound_delta sequences, spans, is_final |
| `src/confirmation.ts` | Confirmation request/response state machine + timeout |
| `src/interrupt.ts` | Voice interrupt handling + playback ledger |
| `src/delivery-ack.ts` | Delivery acknowledgment tracking |
| `src/channel.ts` | OpenClaw InboundAdapter + OutboundAdapter wiring |
| `test/unit/protocol.test.ts` | Protocol type parsing tests |
| `test/unit/session.test.ts` | Session mapping tests |
| `test/unit/reconnect.test.ts` | Backoff algorithm tests |
| `test/unit/inbound.test.ts` | Inbound message conversion tests |
| `test/unit/outbound.test.ts` | Outbound message formatting tests |
| `test/unit/confirmation.test.ts` | Confirmation state machine tests |
| `test/unit/interrupt.test.ts` | Interrupt + ledger tests |
| `test/integration/mock-server.ts` | Mock Museve Channel Server for integration tests |
| `test/integration/connect.test.ts` | Full connect → auth → connected flow |
| `test/integration/message-flow.test.ts` | End-to-end message round-trip |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `openclaw.plugin.json`
- Create: `src/logger.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "@museve/voice-openclaw-plugin",
  "version": "0.1.0",
  "type": "module",
  "description": "Museve Voice Channel plugin for OpenClaw.",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "setupEntry": "./dist/setup-entry.js",
    "channel": {
      "id": "museve_voice",
      "label": "Museve Voice",
      "blurb": "Talk to your OpenClaw agents through Museve voice devices."
    }
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["index.ts", "setup-entry.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create openclaw.plugin.json**

```json
{
  "id": "museve_voice",
  "name": "Museve Voice",
  "version": "0.1.0",
  "description": "Voice channel plugin that connects Museve glasses and Pupa voice cloud to OpenClaw agents.",
  "main": "./dist/index.js",
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "setupEntry": "./dist/setup-entry.js",
    "channel": {
      "id": "museve_voice",
      "label": "Museve Voice",
      "selectionLabel": "Museve Voice (语音)",
      "docsPath": "/channels/museve-voice",
      "blurb": "Talk to your OpenClaw agents through Museve voice devices.",
      "order": 200
    },
    "install": {
      "npmSpec": "@museve/voice-openclaw-plugin",
      "localPath": "extensions/museve-voice",
      "defaultChoice": "npm"
    }
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
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
        "default": "museve_voice"
      },
      "streaming": {
        "type": "boolean",
        "default": true
      },
      "replyMode": {
        "type": "string",
        "enum": ["voice_first", "text_first", "both"],
        "default": "voice_first"
      }
    },
    "required": ["token"]
  },
  "uiHints": {
    "token": { "label": "Channel Token", "sensitive": true, "placeholder": "museve_channel_..." },
    "serverUrl": { "label": "Server URL" },
    "agentId": { "label": "Agent ID" },
    "streaming": { "label": "Streaming Replies" },
    "replyMode": { "label": "Reply Mode" }
  }
}
```

- [ ] **Step 4: Create src/logger.ts**

```typescript
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatMessage(level: LogLevel, tag: string, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] [museve-voice:${tag}] ${msg}`;
}

export function createLogger(tag: string) {
  return {
    debug(msg: string, ...args: unknown[]) {
      if (shouldLog("debug")) console.debug(formatMessage("debug", tag, msg), ...args);
    },
    info(msg: string, ...args: unknown[]) {
      if (shouldLog("info")) console.info(formatMessage("info", tag, msg), ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", tag, msg), ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (shouldLog("error")) console.error(formatMessage("error", tag, msg), ...args);
    },
  };
}
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules` created, `package-lock.json` generated, no errors.

- [ ] **Step 6: Verify build toolchain**

Run: `npx tsc --noEmit`
Expected: No errors (only logger.ts exists, no imports to fail).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json openclaw.plugin.json src/logger.ts package-lock.json
git commit -m "feat: scaffold project with package.json, tsconfig, plugin manifest, and logger"
```

---

## Task 2: Config & Protocol Types

**Files:**
- Create: `src/config.ts`
- Create: `src/protocol.ts`
- Create: `src/session.ts`
- Test: `test/unit/protocol.test.ts`
- Test: `test/unit/session.test.ts`

- [ ] **Step 1: Write failing test for protocol event parsing**

Create `test/unit/protocol.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseEvent, isValidEvent, type XvcEvent } from "../../src/protocol.js";

describe("protocol", () => {
  it("parses a valid inbound_message event", () => {
    const raw = JSON.stringify({
      event_id: "evt_001",
      type: "inbound_message",
      created_at: 1718000000000,
      idempotency_key: "idem_001",
      payload: {
        message_id: "msg_001",
        chat_id: "museve:user:u123",
        chat_type: "direct",
        sender: { id: "u123", name: "Test" },
        text: "hello",
        metadata: { input_type: "voice", language: "zh-CN", asr_confidence: 0.9 },
      },
    });
    const event = parseEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("inbound_message");
    expect(event!.event_id).toBe("evt_001");
  });

  it("returns null for malformed JSON", () => {
    expect(parseEvent("not json")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    const raw = JSON.stringify({ type: "inbound_message" });
    expect(parseEvent(raw)).toBeNull();
  });

  it("validates event structure", () => {
    const valid: XvcEvent = {
      event_id: "evt_002",
      type: "ping",
      created_at: 1718000000000,
      idempotency_key: "idem_002",
      payload: { ts: 1718000000000 },
    };
    expect(isValidEvent(valid)).toBe(true);
  });

  it("rejects event without event_id", () => {
    const invalid = { type: "ping", created_at: 123, payload: {} } as any;
    expect(isValidEvent(invalid)).toBe(false);
  });
});
```

- [ ] **Step 2: Write failing test for session mapping**

Create `test/unit/session.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSessionId, parseSessionId } from "../../src/session.js";

describe("session", () => {
  it("builds direct session ID", () => {
    expect(buildSessionId("direct", "u123", "museve_voice")).toBe("museve_voice:direct:u123");
  });

  it("builds room session ID", () => {
    expect(buildSessionId("room", "room_abc", "museve_voice")).toBe("museve_voice:room:room_abc");
  });

  it("parses direct session ID", () => {
    const parsed = parseSessionId("museve_voice:direct:u123");
    expect(parsed).toEqual({ type: "direct", id: "u123", prefix: "museve_voice" });
  });

  it("parses room session ID", () => {
    const parsed = parseSessionId("museve_voice:room:room_abc");
    expect(parsed).toEqual({ type: "room", id: "room_abc", prefix: "museve_voice" });
  });

  it("returns null for invalid session ID", () => {
    expect(parseSessionId("invalid")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/protocol.test.ts test/unit/session.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement src/config.ts**

```typescript
export interface RiskPolicy {
  confirmExternalSend: boolean;
  confirmDangerousTools: boolean;
  allowPureVoiceR3: boolean;
}

export interface ReconnectConfig {
  minDelayMs: number;
  maxDelayMs: number;
  resume: boolean;
}

export interface MuseveVoiceConfig {
  enabled: boolean;
  serverUrl: string;
  token: string;
  agentId: string;
  sessionPrefix: string;
  streaming: boolean;
  replyMode: "voice_first" | "text_first" | "both";
  riskPolicy: RiskPolicy;
  reconnect: ReconnectConfig;
}

export const DEFAULT_CONFIG: Omit<MuseveVoiceConfig, "token"> = {
  enabled: false,
  serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
  agentId: "voice",
  sessionPrefix: "museve_voice",
  streaming: true,
  replyMode: "voice_first",
  riskPolicy: {
    confirmExternalSend: true,
    confirmDangerousTools: true,
    allowPureVoiceR3: false,
  },
  reconnect: {
    minDelayMs: 1000,
    maxDelayMs: 30000,
    resume: true,
  },
};

export function resolveConfig(raw: Partial<MuseveVoiceConfig> & { token: string }): MuseveVoiceConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...raw.riskPolicy },
    reconnect: { ...DEFAULT_CONFIG.reconnect, ...raw.reconnect },
  };
}
```

- [ ] **Step 5: Implement src/protocol.ts**

```typescript
export type XvcEventType =
  | "connect"
  | "connected"
  | "ping"
  | "pong"
  | "resume"
  | "resumed"
  | "inbound_message"
  | "outbound_message"
  | "outbound_delta"
  | "confirmation_request"
  | "confirmation_response"
  | "voice_interrupt"
  | "delivery_ack"
  | "task_started"
  | "task_done"
  | "error";

export interface XvcEvent<T = unknown> {
  event_id: string;
  type: XvcEventType;
  created_at: number;
  idempotency_key: string;
  payload: T;
}

export interface ConnectPayload {
  protocol_version: number;
  client: {
    kind: string;
    plugin: string;
    plugin_version: string;
    instance_id: string;
    device_name: string;
  };
  channel: string;
  auth: { token: string };
  capabilities: string[];
}

export interface ConnectedPayload {
  connection_id: string;
  user_id: string;
  heartbeat_interval_ms: number;
  server_capabilities: string[];
}

export interface PingPayload {
  ts: number;
}

export interface PongPayload {
  ts: number;
}

export interface ResumePayload {
  connection_id: string;
  last_event_id: string;
  auth: { token: string };
}

export interface InboundMessagePayload {
  message_id: string;
  chat_id: string;
  chat_type: "direct" | "room";
  sender: { id: string; name: string };
  text: string;
  metadata: {
    input_type: "voice" | "text";
    language?: string;
    asr_confidence?: number;
    device_id?: string;
    wake_source?: string;
    duplex_session_id?: string;
  };
}

export interface OutboundMessagePayload {
  message_id: string;
  chat_id: string;
  reply_to: string;
  text: string;
  metadata: {
    output_type: "voice_preferred" | "text_preferred" | "both";
    priority: "normal" | "urgent";
    speak: boolean;
    phone_push: boolean;
  };
}

export interface OutboundDeltaPayload {
  message_id: string;
  chat_id: string;
  delta_seq: number;
  text_delta: string;
  span_id: string;
  is_final: boolean;
}

export interface ConfirmationRequestPayload {
  confirmation_id: string;
  chat_id: string;
  reply_to: string;
  text: string;
  risk_level: "R0" | "R1" | "R2" | "R3";
  expires_at: number;
  confirm_methods: Array<"voice" | "phone_card">;
}

export interface ConfirmationResponsePayload {
  confirmation_id: string;
  chat_id: string;
  result: "confirmed" | "denied" | "timeout";
  text: string;
  asr_confidence?: number;
  method: "voice" | "phone_card";
}

export interface VoiceInterruptPayload {
  chat_id: string;
  duplex_session_id: string;
  interrupted_message_id: string;
  text: string;
  decision: "STOP" | "STEER";
  played_until: {
    span_id: string;
    chunk_seq: number;
  };
  ledger_summary: {
    delivered_text: string;
    not_delivered: boolean;
  };
  metadata: {
    asr_confidence: number;
    barge_in_type: "semantic_stop" | "explicit_stop" | "new_intent";
  };
}

export interface DeliveryAckPayload {
  message_id: string;
  status: "delivered" | "played" | "failed";
  played_until?: {
    span_id: string;
    chunk_seq: number;
  };
}

export interface TaskStartedPayload {
  task_id: string;
  text: string;
}

export interface TaskDonePayload {
  task_id: string;
  text: string;
  result_summary?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export function isValidEvent(event: unknown): event is XvcEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.event_id === "string" &&
    typeof e.type === "string" &&
    typeof e.created_at === "number" &&
    typeof e.payload === "object" &&
    e.payload !== null
  );
}

export function parseEvent(raw: string): XvcEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (isValidEvent(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function createEvent<T>(type: XvcEventType, payload: T, eventId?: string): XvcEvent<T> {
  const id = eventId ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    event_id: id,
    type,
    created_at: Date.now(),
    idempotency_key: `idem_${id}`,
    payload,
  };
}
```

- [ ] **Step 6: Implement src/session.ts**

```typescript
export type SessionType = "direct" | "room";

export interface ParsedSession {
  type: SessionType;
  id: string;
  prefix: string;
}

export function buildSessionId(type: SessionType, id: string, prefix: string): string {
  return `${prefix}:${type}:${id}`;
}

export function parseSessionId(sessionId: string): ParsedSession | null {
  const parts = sessionId.split(":");
  if (parts.length !== 3) return null;
  const [prefix, type, id] = parts;
  if (type !== "direct" && type !== "room") return null;
  if (!prefix || !id) return null;
  return { type, id, prefix };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run test/unit/protocol.test.ts test/unit/session.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/protocol.ts src/session.ts test/unit/protocol.test.ts test/unit/session.test.ts
git commit -m "feat: add config types, XVC protocol definitions, and session mapping"
```

---

## Task 3: WebSocket Transport Client

**Files:**
- Create: `src/client.ts`
- Create: `src/reconnect.ts`
- Test: `test/unit/reconnect.test.ts`

- [ ] **Step 1: Write failing test for reconnect backoff**

Create `test/unit/reconnect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReconnectManager } from "../../src/reconnect.js";

describe("ReconnectManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with minDelay", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    expect(mgr.nextDelay()).toBe(1000);
  });

  it("increases delay exponentially", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    expect(mgr.nextDelay()).toBe(1000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(2000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(5000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(15000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(30000);
  });

  it("caps at maxDelay", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    for (let i = 0; i < 20; i++) mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(30000);
  });

  it("resets after successful connection", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    mgr.recordAttempt();
    mgr.recordAttempt();
    mgr.reset();
    expect(mgr.nextDelay()).toBe(1000);
  });

  it("tracks last event id for resume", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    mgr.recordEventId("evt_100");
    mgr.recordEventId("evt_200");
    expect(mgr.lastEventId).toBe("evt_200");
  });

  it("schedules reconnect callback", async () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    const fn = vi.fn();
    mgr.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("cancel prevents scheduled callback", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    const fn = vi.fn();
    mgr.schedule(fn);
    mgr.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/reconnect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/reconnect.ts**

```typescript
import type { ReconnectConfig } from "./config.js";

const BACKOFF_STEPS = [1000, 2000, 5000, 15000, 30000];

export class ReconnectManager {
  private config: ReconnectConfig;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _lastEventId: string | null = null;
  private _connectionId: string | null = null;

  constructor(config: ReconnectConfig) {
    this.config = config;
  }

  get lastEventId(): string | null {
    return this._lastEventId;
  }

  get connectionId(): string | null {
    return this._connectionId;
  }

  get shouldResume(): boolean {
    return this.config.resume && this._connectionId !== null && this._lastEventId !== null;
  }

  nextDelay(): number {
    const step = Math.min(this.attempt, BACKOFF_STEPS.length - 1);
    const delay = BACKOFF_STEPS[step];
    return Math.min(delay, this.config.maxDelayMs);
  }

  recordAttempt(): void {
    this.attempt++;
  }

  recordEventId(eventId: string): void {
    this._lastEventId = eventId;
  }

  recordConnectionId(connectionId: string): void {
    this._connectionId = connectionId;
  }

  reset(): void {
    this.attempt = 0;
    this.cancel();
  }

  schedule(fn: () => void): void {
    this.cancel();
    const delay = this.nextDelay();
    this.timer = setTimeout(fn, delay);
    this.recordAttempt();
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  clearSession(): void {
    this._lastEventId = null;
    this._connectionId = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/reconnect.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Implement src/client.ts**

```typescript
import WebSocket from "ws";
import { createLogger } from "./logger.js";
import { type MuseveVoiceConfig } from "./config.js";
import { ReconnectManager } from "./reconnect.js";
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
  private config: MuseveVoiceConfig;
  private ws: WebSocket | null = null;
  private reconnect: ReconnectManager;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs = 15000;
  private missedPongs = 0;
  private maxMissedPongs = 3;
  private status: ConnectionStatus = "disconnected";
  private events: ClientEvents;
  private instanceId: string;

  constructor(config: MuseveVoiceConfig, events: ClientEvents) {
    this.config = config;
    this.events = events;
    this.reconnect = new ReconnectManager(config.reconnect);
    this.instanceId = `oc_${Date.now().toString(36)}`;
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
      this.sendResume();
    } else {
      this.sendConnect();
    }
  }

  private sendConnect(): void {
    const payload: ConnectPayload = {
      protocol_version: 1,
      client: {
        kind: "openclaw",
        plugin: "@museve/voice-openclaw-plugin",
        plugin_version: "0.1.0",
        instance_id: this.instanceId,
        device_name: "OpenClaw Instance",
      },
      channel: "museve_voice",
      auth: { token: this.config.token },
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

  private sendResume(): void {
    const payload: ResumePayload = {
      connection_id: this.reconnect.connectionId!,
      last_event_id: this.reconnect.lastEventId!,
      auth: { token: this.config.token },
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
```

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/client.ts src/reconnect.ts test/unit/reconnect.test.ts
git commit -m "feat: add WebSocket transport client with heartbeat and reconnect"
```

---

## Task 4: Inbound Message Handling

**Files:**
- Create: `src/inbound.ts`
- Test: `test/unit/inbound.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/unit/inbound.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "../../src/inbound.js";
import type { XvcEvent, InboundMessagePayload } from "../../src/protocol.js";

describe("inbound", () => {
  const makeEvent = (payload: InboundMessagePayload): XvcEvent<InboundMessagePayload> => ({
    event_id: "evt_001",
    type: "inbound_message",
    created_at: 1718000000000,
    idempotency_key: "idem_001",
    payload,
  });

  it("converts inbound_message to OpenClaw InboundMessage", () => {
    const event = makeEvent({
      message_id: "msg_001",
      chat_id: "museve:user:u123",
      chat_type: "direct",
      sender: { id: "u123", name: "杨立" },
      text: "帮我看看今天有什么待办",
      metadata: {
        input_type: "voice",
        language: "zh-CN",
        asr_confidence: 0.93,
        device_id: "glasses_abc",
        wake_source: "wake_word",
        duplex_session_id: "duplex_789",
      },
    });

    const result = parseInboundMessage(event);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("msg_001");
    expect(result!.text).toBe("帮我看看今天有什么待办");
    expect(result!.sender.id).toBe("u123");
    expect(result!.sender.name).toBe("杨立");
    expect(result!.conversationId).toBe("museve:user:u123");
    expect(result!.conversationType).toBe("direct");
    expect(result!.timestamp).toBe(1718000000000);
    expect(result!.raw).toBe(event.payload);
  });

  it("handles missing optional metadata fields", () => {
    const event = makeEvent({
      message_id: "msg_002",
      chat_id: "museve:user:u456",
      chat_type: "direct",
      sender: { id: "u456", name: "Test" },
      text: "hello",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("hello");
  });

  it("returns null for empty text", () => {
    const event = makeEvent({
      message_id: "msg_003",
      chat_id: "museve:user:u789",
      chat_type: "direct",
      sender: { id: "u789", name: "Test" },
      text: "",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/inbound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/inbound.ts**

```typescript
import type { XvcEvent, InboundMessagePayload } from "./protocol.js";

export interface InboundMessage {
  id: string;
  type: "text";
  text: string;
  sender: { id: string; name: string };
  conversationId: string;
  conversationType: "direct" | "group";
  timestamp: number;
  replyToId?: string;
  raw: InboundMessagePayload;
}

export function parseInboundMessage(event: XvcEvent<InboundMessagePayload>): InboundMessage | null {
  const { payload } = event;

  if (!payload.text || payload.text.trim() === "") {
    return null;
  }

  return {
    id: payload.message_id,
    type: "text",
    text: payload.text,
    sender: {
      id: payload.sender.id,
      name: payload.sender.name,
    },
    conversationId: payload.chat_id,
    conversationType: payload.chat_type === "room" ? "group" : "direct",
    timestamp: event.created_at,
    raw: payload,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/inbound.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inbound.ts test/unit/inbound.test.ts
git commit -m "feat: add inbound message parsing (Museve → OpenClaw)"
```

---

## Task 5: Outbound Message Formatting

**Files:**
- Create: `src/outbound.ts`
- Test: `test/unit/outbound.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/unit/outbound.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatOutboundMessage, formatOutboundDelta } from "../../src/outbound.js";

describe("outbound", () => {
  it("formats a complete reply as outbound_message", () => {
    const result = formatOutboundMessage({
      messageId: "reply_001",
      chatId: "museve:user:u123",
      replyTo: "msg_001",
      text: "你今天有三个待办",
      replyMode: "voice_first",
    });

    expect(result.type).toBe("outbound_message");
    expect(result.payload.message_id).toBe("reply_001");
    expect(result.payload.chat_id).toBe("museve:user:u123");
    expect(result.payload.reply_to).toBe("msg_001");
    expect(result.payload.text).toBe("你今天有三个待办");
    expect(result.payload.metadata.speak).toBe(true);
    expect(result.payload.metadata.output_type).toBe("voice_preferred");
  });

  it("formats text_first reply mode", () => {
    const result = formatOutboundMessage({
      messageId: "reply_002",
      chatId: "museve:user:u123",
      replyTo: "msg_002",
      text: "hello",
      replyMode: "text_first",
    });

    expect(result.payload.metadata.output_type).toBe("text_preferred");
    expect(result.payload.metadata.speak).toBe(false);
  });

  it("formats a streaming delta", () => {
    const result = formatOutboundDelta({
      messageId: "reply_001",
      chatId: "museve:user:u123",
      deltaSeq: 3,
      textDelta: "三个待办",
      spanId: "span_001",
      isFinal: false,
    });

    expect(result.type).toBe("outbound_delta");
    expect(result.payload.message_id).toBe("reply_001");
    expect(result.payload.delta_seq).toBe(3);
    expect(result.payload.text_delta).toBe("三个待办");
    expect(result.payload.span_id).toBe("span_001");
    expect(result.payload.is_final).toBe(false);
  });

  it("formats final delta", () => {
    const result = formatOutboundDelta({
      messageId: "reply_001",
      chatId: "museve:user:u123",
      deltaSeq: 10,
      textDelta: "",
      spanId: "span_001",
      isFinal: true,
    });

    expect(result.payload.is_final).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/outbound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/outbound.ts**

```typescript
import { createEvent, type XvcEvent, type OutboundMessagePayload, type OutboundDeltaPayload } from "./protocol.js";

export interface OutboundMessageOptions {
  messageId: string;
  chatId: string;
  replyTo: string;
  text: string;
  replyMode: "voice_first" | "text_first" | "both";
  priority?: "normal" | "urgent";
  phonePush?: boolean;
}

export interface OutboundDeltaOptions {
  messageId: string;
  chatId: string;
  deltaSeq: number;
  textDelta: string;
  spanId: string;
  isFinal: boolean;
}

export function formatOutboundMessage(opts: OutboundMessageOptions): XvcEvent<OutboundMessagePayload> {
  const outputType = opts.replyMode === "voice_first"
    ? "voice_preferred"
    : opts.replyMode === "text_first"
      ? "text_preferred"
      : "both";

  const speak = opts.replyMode !== "text_first";

  const payload: OutboundMessagePayload = {
    message_id: opts.messageId,
    chat_id: opts.chatId,
    reply_to: opts.replyTo,
    text: opts.text,
    metadata: {
      output_type: outputType,
      priority: opts.priority ?? "normal",
      speak,
      phone_push: opts.phonePush ?? false,
    },
  };

  return createEvent("outbound_message", payload);
}

export function formatOutboundDelta(opts: OutboundDeltaOptions): XvcEvent<OutboundDeltaPayload> {
  const payload: OutboundDeltaPayload = {
    message_id: opts.messageId,
    chat_id: opts.chatId,
    delta_seq: opts.deltaSeq,
    text_delta: opts.textDelta,
    span_id: opts.spanId,
    is_final: opts.isFinal,
  };

  return createEvent("outbound_delta", payload);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/outbound.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/outbound.ts test/unit/outbound.test.ts
git commit -m "feat: add outbound message formatting (OpenClaw → Museve)"
```

---

## Task 6: Streaming Delta Manager

**Files:**
- Create: `src/streaming.ts`

- [ ] **Step 1: Implement src/streaming.ts**

```typescript
import { createLogger } from "./logger.js";
import { formatOutboundDelta, type OutboundDeltaOptions } from "./outbound.js";
import type { XvcEvent, OutboundDeltaPayload } from "./protocol.js";

const log = createLogger("streaming");

export interface StreamSession {
  messageId: string;
  chatId: string;
  spanId: string;
  deltaSeq: number;
  totalText: string;
}

export class StreamingManager {
  private sessions = new Map<string, StreamSession>();

  startStream(messageId: string, chatId: string): StreamSession {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: StreamSession = {
      messageId,
      chatId,
      spanId,
      deltaSeq: 0,
      totalText: "",
    };
    this.sessions.set(messageId, session);
    log.debug(`Stream started: ${messageId}`);
    return session;
  }

  pushDelta(messageId: string, textDelta: string): XvcEvent<OutboundDeltaPayload> | null {
    const session = this.sessions.get(messageId);
    if (!session) {
      log.warn(`No stream session for ${messageId}`);
      return null;
    }

    session.deltaSeq++;
    session.totalText += textDelta;

    return formatOutboundDelta({
      messageId: session.messageId,
      chatId: session.chatId,
      deltaSeq: session.deltaSeq,
      textDelta,
      spanId: session.spanId,
      isFinal: false,
    });
  }

  endStream(messageId: string): XvcEvent<OutboundDeltaPayload> | null {
    const session = this.sessions.get(messageId);
    if (!session) {
      log.warn(`No stream session to end: ${messageId}`);
      return null;
    }

    session.deltaSeq++;
    const finalEvent = formatOutboundDelta({
      messageId: session.messageId,
      chatId: session.chatId,
      deltaSeq: session.deltaSeq,
      textDelta: "",
      spanId: session.spanId,
      isFinal: true,
    });

    this.sessions.delete(messageId);
    log.debug(`Stream ended: ${messageId}, total length=${session.totalText.length}`);
    return finalEvent;
  }

  cancelStream(messageId: string): void {
    if (this.sessions.has(messageId)) {
      this.sessions.delete(messageId);
      log.debug(`Stream cancelled: ${messageId}`);
    }
  }

  getSession(messageId: string): StreamSession | undefined {
    return this.sessions.get(messageId);
  }

  hasActiveStream(messageId: string): boolean {
    return this.sessions.has(messageId);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/streaming.ts
git commit -m "feat: add streaming delta manager for outbound_delta sequences"
```

---

## Task 7: Confirmation State Machine

**Files:**
- Create: `src/confirmation.ts`
- Test: `test/unit/confirmation.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/unit/confirmation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfirmationManager } from "../../src/confirmation.js";
import type { ConfirmationRequestPayload, ConfirmationResponsePayload } from "../../src/protocol.js";

describe("ConfirmationManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a pending confirmation", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_001",
      chat_id: "museve:user:u123",
      reply_to: "msg_001",
      text: "确认发送吗？",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice", "phone_card"],
    };

    mgr.addPending(request);
    expect(mgr.hasPending("conf_001")).toBe(true);
    expect(mgr.getPending("conf_001")).toEqual(request);
  });

  it("resolves a confirmation with confirmed", () => {
    const mgr = new ConfirmationManager();
    const onResolve = vi.fn();
    mgr.onResolve(onResolve);

    mgr.addPending({
      confirmation_id: "conf_001",
      chat_id: "museve:user:u123",
      reply_to: "msg_001",
      text: "确认发送吗？",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });

    const response: ConfirmationResponsePayload = {
      confirmation_id: "conf_001",
      chat_id: "museve:user:u123",
      result: "confirmed",
      text: "确认",
      asr_confidence: 0.95,
      method: "voice",
    };

    mgr.resolve(response);
    expect(mgr.hasPending("conf_001")).toBe(false);
    expect(onResolve).toHaveBeenCalledWith(response);
  });

  it("auto-expires pending confirmation", () => {
    const mgr = new ConfirmationManager();
    const onResolve = vi.fn();
    mgr.onResolve(onResolve);

    const expiresAt = Date.now() + 30000;
    mgr.addPending({
      confirmation_id: "conf_002",
      chat_id: "museve:user:u123",
      reply_to: "msg_002",
      text: "确认？",
      risk_level: "R2",
      expires_at: expiresAt,
      confirm_methods: ["voice"],
    });

    vi.advanceTimersByTime(31000);

    expect(mgr.hasPending("conf_002")).toBe(false);
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ confirmation_id: "conf_002", result: "timeout" })
    );
  });

  it("rejects R3 with voice-only method", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_003",
      chat_id: "museve:user:u123",
      reply_to: "msg_003",
      text: "删除所有数据？",
      risk_level: "R3",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    };

    const result = mgr.validateRequest(request, { allowPureVoiceR3: false });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("R3");
  });

  it("allows R3 with phone_card method", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_004",
      chat_id: "museve:user:u123",
      reply_to: "msg_004",
      text: "删除所有数据？",
      risk_level: "R3",
      expires_at: Date.now() + 60000,
      confirm_methods: ["phone_card"],
    };

    const result = mgr.validateRequest(request, { allowPureVoiceR3: false });
    expect(result.valid).toBe(true);
  });

  it("cleanup removes all pending confirmations", () => {
    const mgr = new ConfirmationManager();
    mgr.addPending({
      confirmation_id: "conf_a",
      chat_id: "museve:user:u123",
      reply_to: "msg_a",
      text: "a?",
      risk_level: "R1",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });
    mgr.addPending({
      confirmation_id: "conf_b",
      chat_id: "museve:user:u123",
      reply_to: "msg_b",
      text: "b?",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });

    mgr.cleanup();
    expect(mgr.hasPending("conf_a")).toBe(false);
    expect(mgr.hasPending("conf_b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/confirmation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/confirmation.ts**

```typescript
import { createLogger } from "./logger.js";
import type { ConfirmationRequestPayload, ConfirmationResponsePayload } from "./protocol.js";

const log = createLogger("confirmation");

interface PendingConfirmation {
  request: ConfirmationRequestPayload;
  timer: ReturnType<typeof setTimeout>;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class ConfirmationManager {
  private pending = new Map<string, PendingConfirmation>();
  private resolveCallback: ((response: ConfirmationResponsePayload) => void) | null = null;

  onResolve(callback: (response: ConfirmationResponsePayload) => void): void {
    this.resolveCallback = callback;
  }

  validateRequest(
    request: ConfirmationRequestPayload,
    policy: { allowPureVoiceR3: boolean }
  ): ValidationResult {
    if (request.risk_level === "R3" && !policy.allowPureVoiceR3) {
      const hasPhoneCard = request.confirm_methods.includes("phone_card");
      if (!hasPhoneCard) {
        return {
          valid: false,
          reason: "R3 operations require phone_card confirmation, pure voice not allowed",
        };
      }
    }
    return { valid: true };
  }

  addPending(request: ConfirmationRequestPayload): void {
    const timeoutMs = Math.max(0, request.expires_at - Date.now());

    const timer = setTimeout(() => {
      this.handleTimeout(request.confirmation_id);
    }, timeoutMs);

    this.pending.set(request.confirmation_id, { request, timer });
    log.info(`Pending confirmation added: ${request.confirmation_id} (expires in ${timeoutMs}ms)`);
  }

  resolve(response: ConfirmationResponsePayload): void {
    const entry = this.pending.get(response.confirmation_id);
    if (!entry) {
      log.warn(`No pending confirmation for ${response.confirmation_id}`);
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(response.confirmation_id);
    log.info(`Confirmation resolved: ${response.confirmation_id} → ${response.result}`);
    this.resolveCallback?.(response);
  }

  hasPending(confirmationId: string): boolean {
    return this.pending.has(confirmationId);
  }

  getPending(confirmationId: string): ConfirmationRequestPayload | undefined {
    return this.pending.get(confirmationId)?.request;
  }

  cleanup(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    log.info("All pending confirmations cleared");
  }

  private handleTimeout(confirmationId: string): void {
    const entry = this.pending.get(confirmationId);
    if (!entry) return;

    this.pending.delete(confirmationId);
    log.info(`Confirmation timed out: ${confirmationId}`);

    const timeoutResponse: ConfirmationResponsePayload = {
      confirmation_id: confirmationId,
      chat_id: entry.request.chat_id,
      result: "timeout",
      text: "",
      method: entry.request.confirm_methods[0],
    };

    this.resolveCallback?.(timeoutResponse);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/confirmation.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/confirmation.ts test/unit/confirmation.test.ts
git commit -m "feat: add confirmation state machine with timeout and R3 policy"
```

---

## Task 8: Voice Interrupt Handler

**Files:**
- Create: `src/interrupt.ts`
- Test: `test/unit/interrupt.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/unit/interrupt.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { InterruptHandler } from "../../src/interrupt.js";
import type { XvcEvent, VoiceInterruptPayload } from "../../src/protocol.js";

describe("InterruptHandler", () => {
  const makeInterruptEvent = (overrides?: Partial<VoiceInterruptPayload>): XvcEvent<VoiceInterruptPayload> => ({
    event_id: "evt_int_001",
    type: "voice_interrupt",
    created_at: Date.now(),
    idempotency_key: "idem_int_001",
    payload: {
      chat_id: "museve:user:u123",
      duplex_session_id: "duplex_789",
      interrupted_message_id: "reply_001",
      text: "停，直接说下午的",
      decision: "STOP",
      played_until: { span_id: "span_001", chunk_seq: 21 },
      ledger_summary: { delivered_text: "你今天上午有...", not_delivered: true },
      metadata: { asr_confidence: 0.91, barge_in_type: "semantic_stop" },
      ...overrides,
    },
  });

  it("processes interrupt and returns follow-up message", () => {
    const handler = new InterruptHandler();
    const onCancel = vi.fn();
    handler.onCancelRun(onCancel);

    const result = handler.handleInterrupt(makeInterruptEvent());

    expect(onCancel).toHaveBeenCalledWith("reply_001");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("停，直接说下午的");
    expect(result!.conversationId).toBe("museve:user:u123");
  });

  it("records playback ledger", () => {
    const handler = new InterruptHandler();
    handler.handleInterrupt(makeInterruptEvent());

    const ledger = handler.getLedger("reply_001");
    expect(ledger).not.toBeNull();
    expect(ledger!.deliveredText).toBe("你今天上午有...");
    expect(ledger!.playedUntil.span_id).toBe("span_001");
    expect(ledger!.playedUntil.chunk_seq).toBe(21);
  });

  it("handles STEER decision", () => {
    const handler = new InterruptHandler();
    const onCancel = vi.fn();
    handler.onCancelRun(onCancel);

    const result = handler.handleInterrupt(makeInterruptEvent({ decision: "STEER" }));

    expect(onCancel).toHaveBeenCalledWith("reply_001");
    expect(result).not.toBeNull();
  });

  it("ignores interrupt with empty text", () => {
    const handler = new InterruptHandler();
    const result = handler.handleInterrupt(makeInterruptEvent({ text: "" }));
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/interrupt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/interrupt.ts**

```typescript
import { createLogger } from "./logger.js";
import type { XvcEvent, VoiceInterruptPayload } from "./protocol.js";
import type { InboundMessage } from "./inbound.js";

const log = createLogger("interrupt");

export interface PlaybackLedger {
  messageId: string;
  deliveredText: string;
  notDelivered: boolean;
  playedUntil: { span_id: string; chunk_seq: number };
}

export class InterruptHandler {
  private ledgers = new Map<string, PlaybackLedger>();
  private cancelCallback: ((messageId: string) => void) | null = null;

  onCancelRun(callback: (messageId: string) => void): void {
    this.cancelCallback = callback;
  }

  handleInterrupt(event: XvcEvent<VoiceInterruptPayload>): InboundMessage | null {
    const { payload } = event;

    log.info(`Interrupt received: msg=${payload.interrupted_message_id}, decision=${payload.decision}`);

    this.ledgers.set(payload.interrupted_message_id, {
      messageId: payload.interrupted_message_id,
      deliveredText: payload.ledger_summary.delivered_text,
      notDelivered: payload.ledger_summary.not_delivered,
      playedUntil: payload.played_until,
    });

    this.cancelCallback?.(payload.interrupted_message_id);

    if (!payload.text || payload.text.trim() === "") {
      return null;
    }

    const followUp: InboundMessage = {
      id: `interrupt_${event.event_id}`,
      type: "text",
      text: payload.text,
      sender: { id: payload.chat_id.split(":").pop() ?? "unknown", name: "User" },
      conversationId: payload.chat_id,
      conversationType: "direct",
      timestamp: event.created_at,
      raw: payload as any,
    };

    return followUp;
  }

  getLedger(messageId: string): PlaybackLedger | null {
    return this.ledgers.get(messageId) ?? null;
  }

  clearLedger(messageId: string): void {
    this.ledgers.delete(messageId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/interrupt.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interrupt.ts test/unit/interrupt.test.ts
git commit -m "feat: add voice interrupt handler with playback ledger"
```

---

## Task 9: Delivery Acknowledgment

**Files:**
- Create: `src/delivery-ack.ts`

- [ ] **Step 1: Implement src/delivery-ack.ts**

```typescript
import { createLogger } from "./logger.js";
import type { DeliveryAckPayload } from "./protocol.js";

const log = createLogger("delivery-ack");

export type DeliveryStatus = "sent" | "delivered" | "played" | "failed";

interface TrackedMessage {
  messageId: string;
  status: DeliveryStatus;
  sentAt: number;
  deliveredAt?: number;
  playedUntil?: { span_id: string; chunk_seq: number };
}

export class DeliveryTracker {
  private messages = new Map<string, TrackedMessage>();
  private statusCallback: ((messageId: string, status: DeliveryStatus) => void) | null = null;

  onStatusChange(callback: (messageId: string, status: DeliveryStatus) => void): void {
    this.statusCallback = callback;
  }

  trackSent(messageId: string): void {
    this.messages.set(messageId, {
      messageId,
      status: "sent",
      sentAt: Date.now(),
    });
  }

  handleAck(payload: DeliveryAckPayload): void {
    const tracked = this.messages.get(payload.message_id);
    if (!tracked) {
      log.warn(`Received ack for untracked message: ${payload.message_id}`);
      return;
    }

    tracked.status = payload.status as DeliveryStatus;
    tracked.deliveredAt = Date.now();
    if (payload.played_until) {
      tracked.playedUntil = payload.played_until;
    }

    log.debug(`Delivery ack: ${payload.message_id} → ${payload.status}`);
    this.statusCallback?.(payload.message_id, tracked.status);
  }

  getStatus(messageId: string): DeliveryStatus | null {
    return this.messages.get(messageId)?.status ?? null;
  }

  cleanup(olderThanMs: number = 300000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, msg] of this.messages) {
      if (msg.sentAt < cutoff) {
        this.messages.delete(id);
      }
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/delivery-ack.ts
git commit -m "feat: add delivery acknowledgment tracker"
```

---

## Task 10: Channel Layer (OpenClaw Integration)

**Files:**
- Create: `src/channel.ts`
- Create: `index.ts`

- [ ] **Step 1: Implement src/channel.ts**

```typescript
import type { XvcEvent, InboundMessagePayload, ConfirmationResponsePayload, VoiceInterruptPayload, DeliveryAckPayload } from "./protocol.js";
import { type MuseveVoiceConfig, resolveConfig } from "./config.js";
import { XvcClient, type ConnectionStatus } from "./client.js";
import { parseInboundMessage, type InboundMessage } from "./inbound.js";
import { formatOutboundMessage } from "./outbound.js";
import { StreamingManager } from "./streaming.js";
import { ConfirmationManager } from "./confirmation.js";
import { InterruptHandler } from "./interrupt.js";
import { DeliveryTracker } from "./delivery-ack.js";
import { buildSessionId } from "./session.js";
import { createLogger } from "./logger.js";

const log = createLogger("channel");

export interface ChannelCallbacks {
  handleMessage: (msg: InboundMessage) => void;
  handleStatus: (status: { status: string }) => void;
}

export class MuseveVoiceChannel {
  private config: MuseveVoiceConfig;
  private client: XvcClient;
  private streaming: StreamingManager;
  private confirmation: ConfirmationManager;
  private interrupt: InterruptHandler;
  private delivery: DeliveryTracker;
  private callbacks: ChannelCallbacks | null = null;

  constructor(rawConfig: Partial<MuseveVoiceConfig> & { token: string }) {
    this.config = resolveConfig(rawConfig);
    this.streaming = new StreamingManager();
    this.confirmation = new ConfirmationManager();
    this.interrupt = new InterruptHandler();
    this.delivery = new DeliveryTracker();

    this.client = new XvcClient(this.config, {
      onEvent: (event) => this.dispatchEvent(event),
      onStatusChange: (status) => this.handleStatusChange(status),
    });

    this.interrupt.onCancelRun((messageId) => {
      this.streaming.cancelStream(messageId);
      log.info(`Cancelled stream for interrupted message: ${messageId}`);
    });

    this.confirmation.onResolve((response) => {
      log.info(`Confirmation ${response.confirmation_id} resolved: ${response.result}`);
    });
  }

  async start(callbacks: ChannelCallbacks): Promise<void> {
    this.callbacks = callbacks;
    await this.client.connect();
  }

  async stop(): Promise<void> {
    this.client.disconnect();
    this.confirmation.cleanup();
    this.callbacks = null;
  }

  sendReply(text: string, replyTo: string, chatId: string): void {
    const messageId = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    if (this.config.streaming) {
      const session = this.streaming.startStream(messageId, chatId);
      const delta = this.streaming.pushDelta(messageId, text);
      if (delta) this.client.send(delta);
      const final = this.streaming.endStream(messageId);
      if (final) this.client.send(final);
    } else {
      const event = formatOutboundMessage({
        messageId,
        chatId,
        replyTo,
        text,
        replyMode: this.config.replyMode,
      });
      this.client.send(event);
    }

    this.delivery.trackSent(messageId);
  }

  sendStreamDelta(messageId: string, chatId: string, textDelta: string): void {
    if (!this.streaming.hasActiveStream(messageId)) {
      this.streaming.startStream(messageId, chatId);
    }
    const delta = this.streaming.pushDelta(messageId, textDelta);
    if (delta) this.client.send(delta);
  }

  endStream(messageId: string): void {
    const final = this.streaming.endStream(messageId);
    if (final) this.client.send(final);
  }

  private dispatchEvent(event: XvcEvent): void {
    switch (event.type) {
      case "inbound_message":
        this.handleInbound(event as XvcEvent<InboundMessagePayload>);
        break;
      case "confirmation_response":
        this.confirmation.resolve(event.payload as ConfirmationResponsePayload);
        break;
      case "voice_interrupt":
        this.handleVoiceInterrupt(event as XvcEvent<VoiceInterruptPayload>);
        break;
      case "delivery_ack":
        this.delivery.handleAck(event.payload as DeliveryAckPayload);
        break;
      default:
        break;
    }
  }

  private handleInbound(event: XvcEvent<InboundMessagePayload>): void {
    const msg = parseInboundMessage(event);
    if (!msg) {
      log.warn("Failed to parse inbound message, skipping");
      return;
    }
    this.callbacks?.handleMessage(msg);
  }

  private handleVoiceInterrupt(event: XvcEvent<VoiceInterruptPayload>): void {
    const followUp = this.interrupt.handleInterrupt(event);
    if (followUp) {
      this.callbacks?.handleMessage(followUp);
    }
  }

  private handleStatusChange(status: ConnectionStatus): void {
    this.callbacks?.handleStatus({ status });
  }
}

export function createInboundAdapter() {
  let channel: MuseveVoiceChannel | null = null;

  return {
    async start({ config, handleMessage, handleStatus }: {
      config: any;
      account?: any;
      handleMessage: (msg: InboundMessage) => void;
      handleEvent?: (event: any) => void;
      handleStatus: (status: { status: string }) => void;
    }) {
      const museveConfig = config.channels?.museveVoice ?? config;
      channel = new MuseveVoiceChannel(museveConfig);
      await channel.start({ handleMessage, handleStatus });
      handleStatus({ status: "ready" });
    },

    async stop() {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },
  };
}

export const outbound = {
  deliveryMode: "direct" as const,

  listAccountIds: () => ["default"],

  resolveAccount: (config: any, accountId?: string) => {
    return config.channels?.museveVoice ?? { accountId: accountId ?? "default" };
  },

  async sendText({ account, config, text, context }: {
    account: any;
    config: any;
    text: string;
    context: { conversationId: string; recipientId?: string; conversationType?: string };
  }) {
    return { ok: true, messageId: `msg_${Date.now()}` };
  },
};
```

- [ ] **Step 2: Implement index.ts**

```typescript
import type { OpenClawApi } from "openclaw";
import { createInboundAdapter, outbound } from "./src/channel.js";

export default function registerMuseveVoicePlugin(api: OpenClawApi) {
  api.registerChannel({
    plugin: {
      id: "museve_voice",
      meta: {
        id: "museve_voice",
        label: "Museve Voice",
        selectionLabel: "Museve Voice (语音)",
        docsPath: "/channels/museve-voice",
        blurb: "Talk to your OpenClaw agents through Museve voice devices.",
      },
      capabilities: {
        chatTypes: ["direct"],
        media: { images: false, files: false },
        reactions: false,
        threads: false,
        mentions: false,
        replyContext: true,
      },
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: (cfg: any, accountId?: string) =>
          cfg.channels?.museveVoice ?? { accountId: accountId ?? "default" },
      },
      outbound,
      inbound: createInboundAdapter(),
    },
  });
}

export { createInboundAdapter, outbound, MuseveVoiceChannel } from "./src/channel.js";
```

- [ ] **Step 3: Create OpenClaw type stub for build**

Create `src/types/openclaw.d.ts`:

```typescript
declare module "openclaw" {
  export interface OpenClawApi {
    registerChannel(opts: { plugin: ChannelPlugin }): void;
  }

  export interface ChannelPlugin {
    id: string;
    meta: {
      id: string;
      label: string;
      selectionLabel?: string;
      docsPath?: string;
      blurb?: string;
    };
    capabilities: Record<string, unknown>;
    config: {
      listAccountIds: (cfg: any) => string[];
      resolveAccount: (cfg: any, accountId?: string) => any;
    };
    outbound: any;
    inbound: any;
  }
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Run all unit tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/channel.ts src/types/openclaw.d.ts index.ts
git commit -m "feat: add channel layer with OpenClaw plugin registration"
```

---

## Task 11: Setup Entry (Binding Wizard)

**Files:**
- Create: `setup-entry.ts`

- [ ] **Step 1: Implement setup-entry.ts**

```typescript
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
          plugin: "@museve/voice-openclaw-plugin",
          plugin_version: "0.1.0",
          instance_id: "setup_verify",
          device_name: "Setup Verification",
        },
        channel: "museve_voice",
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
  context.log("Museve Voice Channel 配置向导");
  context.log("────────────────────────────");
  context.log("");

  const token = await context.prompt("请输入 Museve Channel Token (从 Museve App 获取):");
  if (!token.trim()) {
    context.log("错误: Token 不能为空");
    return;
  }

  const serverUrl = await context.prompt(
    "Channel Server 地址 (默认: wss://asr-test.jlpay.com/agent-channel/connect):"
  );
  const url = serverUrl.trim() || "wss://asr-test.jlpay.com/agent-channel/connect";

  context.log("");
  context.log("正在验证连接...");

  const result = await verifyToken(url, token.trim());

  if (result.success) {
    await context.writeConfig("channels.museveVoice.enabled", true);
    await context.writeConfig("channels.museveVoice.token", token.trim());
    await context.writeConfig("channels.museveVoice.serverUrl", url);
    context.log("✓ 连接验证成功，配置已保存");
  } else {
    context.log(`✗ 连接失败: ${result.error}`);
    context.log("请检查 Token 是否正确，或联系 Museve 支持。");
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add setup-entry.ts
git commit -m "feat: add setup entry for binding code configuration wizard"
```

---

## Task 12: Integration Test Infrastructure

**Files:**
- Create: `test/integration/mock-server.ts`
- Create: `test/integration/connect.test.ts`
- Create: `test/integration/message-flow.test.ts`

- [ ] **Step 1: Create mock server**

Create `test/integration/mock-server.ts`:

```typescript
import { WebSocketServer, WebSocket } from "ws";
import { createEvent, type XvcEvent, type ConnectedPayload } from "../../src/protocol.js";

export interface MockServerOptions {
  port?: number;
  token?: string;
  heartbeatIntervalMs?: number;
}

export class MockMuseveServer {
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
      chat_id: `museve:user:${userId}`,
      chat_type: "direct",
      sender: { id: userId, name: "Test User" },
      text,
      metadata: { input_type: "voice", language: "zh-CN", asr_confidence: 0.95 },
    }));
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
          user_id: "museve_user_test",
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
```

- [ ] **Step 2: Create connect integration test**

Create `test/integration/connect.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockMuseveServer } from "./mock-server.js";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";

describe("integration: connect", () => {
  let server: MockMuseveServer;

  beforeEach(async () => {
    server = new MockMuseveServer({ token: "valid_token" });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("connects and authenticates successfully", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "valid_token", serverUrl: server.getUrl() });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    });

    await client.connect();

    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("connected");
    client.disconnect();
  });

  it("reports auth_failed for invalid token", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "wrong_token", serverUrl: server.getUrl() });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    });

    await client.connect();

    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("auth_failed");
    client.disconnect();
  });
});
```

- [ ] **Step 3: Create message flow integration test**

Create `test/integration/message-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockMuseveServer } from "./mock-server.js";
import { MuseveVoiceChannel } from "../../src/channel.js";
import type { InboundMessage } from "../../src/inbound.js";

describe("integration: message flow", () => {
  let server: MockMuseveServer;

  beforeEach(async () => {
    server = new MockMuseveServer({ token: "valid_token" });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("receives inbound message from Museve", async () => {
    const messages: InboundMessage[] = [];

    const channel = new MuseveVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
    });

    await channel.start({
      handleMessage: (msg) => messages.push(msg),
      handleStatus: () => {},
    });

    await new Promise((r) => setTimeout(r, 300));

    server.sendInboundMessage("今天有什么待办");

    await new Promise((r) => setTimeout(r, 200));

    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe("今天有什么待办");
    expect(messages[0].conversationType).toBe("direct");

    await channel.stop();
  });

  it("sends outbound reply to Museve", async () => {
    const channel = new MuseveVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
      streaming: false,
    });

    await channel.start({
      handleMessage: () => {},
      handleStatus: () => {},
    });

    await new Promise((r) => setTimeout(r, 300));

    channel.sendReply("你有三个待办", "msg_001", "museve:user:u123");

    await new Promise((r) => setTimeout(r, 200));

    const events = server.getReceivedEvents();
    const outbound = events.find((e) => e.type === "outbound_message");
    expect(outbound).toBeDefined();
    expect((outbound!.payload as any).text).toBe("你有三个待办");

    await channel.stop();
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All unit tests PASS. Integration tests PASS (mock server handles auth and message relay).

- [ ] **Step 5: Commit**

```bash
git add test/integration/mock-server.ts test/integration/connect.test.ts test/integration/message-flow.test.ts
git commit -m "feat: add integration tests with mock Museve Channel Server"
```

---

## Task 13: Vitest Configuration & Final Verification

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All unit + integration tests PASS.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run build**

Run: `npx tsc`
Expected: `dist/` directory created with compiled JS + declarations.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "feat: add vitest config, verify full test suite passes"
```

---

## Task 14: Delete Python Placeholder & Update CLAUDE.md

**Files:**
- Delete: `main.py`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove main.py placeholder**

```bash
git rm main.py
```

- [ ] **Step 2: Update CLAUDE.md**

Replace CLAUDE.md content with:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

@museve/voice-openclaw-plugin — OpenClaw Channel 插件，通过 Museve 眼镜语音控制 OpenClaw Agent。

## 构建与运行

```bash
npm install          # 安装依赖
npm run build        # TypeScript 编译到 dist/
npm run dev          # watch 模式
npm run lint         # 类型检查 (tsc --noEmit)
```

## 测试

```bash
npm test             # 运行全部测试
npx vitest run test/unit/protocol.test.ts   # 单个测试文件
npx vitest --watch   # watch 模式
```

## 架构

三层分离：
- **Channel Layer** (`src/channel.ts`, `index.ts`) — OpenClaw 标准 Channel Plugin 注册
- **Protocol Layer** (`src/protocol.ts`, `src/inbound.ts`, `src/outbound.ts`, `src/confirmation.ts`, `src/interrupt.ts`, `src/streaming.ts`, `src/delivery-ack.ts`) — XVC 协议事件处理
- **Transport Layer** (`src/client.ts`, `src/reconnect.ts`) — WebSocket 连接管理

## 语言

- 使用中文进行交流和注释
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Python placeholder, update CLAUDE.md for TypeScript project"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Project scaffolding (package.json, tsconfig, plugin manifest, logger) |
| 2 | Config types, XVC protocol definitions, session mapping |
| 3 | WebSocket client with heartbeat + reconnect manager |
| 4 | Inbound message parsing |
| 5 | Outbound message formatting |
| 6 | Streaming delta manager |
| 7 | Confirmation state machine |
| 8 | Voice interrupt handler |
| 9 | Delivery acknowledgment tracker |
| 10 | Channel layer (OpenClaw integration) |
| 11 | Setup entry (binding wizard) |
| 12 | Integration tests with mock server |
| 13 | Vitest config & final verification |
| 14 | Cleanup & CLAUDE.md update |
