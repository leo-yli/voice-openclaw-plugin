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
  | "error"
  // 控制事件（spec §7）
  | "binding_revoked"
  | "token_rotated_notify"
  | "binding_metadata_updated"
  | "server_announcement";

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

export interface BindingRevokedPayload {
  binding_id: string;
  reason:
    | "user_unbound"
    | "admin_revoked"
    | "suspicious_activity"
    | "user_account_deleted";
  revoked_at: string;
  message?: string;
}

export interface TokenRotatedNotifyPayload {
  binding_id: string;
  request_id: string;
  initiated_by: "user" | "system";
  grace_period_sec: number;
}

export interface BindingMetadataUpdatedPayload {
  binding_id: string;
  changes: {
    device_label?: string;
  };
}

export interface ServerAnnouncementPayload {
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  action_url?: string;
  expires_at?: string;
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
