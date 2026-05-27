import type { XvcEvent, InboundMessagePayload } from "./protocol.js";

export interface InboundMessage {
  id: string;
  sessionId?: string;
  agentBindingId?: string;
  type: "text";
  text: string;
  sender: { id: string; name: string };
  conversationId: string;
  conversationType: "direct" | "group";
  timestamp: number;
  replyToId?: string;
  raw: InboundMessagePayload;
}

type InboundPayloadRecord = InboundMessagePayload & Record<string, unknown>;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readInboundText(payload: InboundPayloadRecord): string {
  const directKeys = [
    "text",
    "transcript",
    "asr_text",
    "asrText",
    "content",
    "query",
    "message",
  ];
  for (const key of directKeys) {
    const value = readString(payload[key]);
    if (value) return value;
  }

  const metadata = readRecord(payload.metadata);
  const asr = readRecord(payload.asr);
  const result = readRecord(payload.result);
  const nestedCandidates = [
    metadata.text,
    metadata.transcript,
    metadata.asr_text,
    metadata.asrText,
    asr.text,
    asr.transcript,
    result.text,
    result.transcript,
  ];

  for (const candidate of nestedCandidates) {
    const value = readString(candidate);
    if (value) return value;
  }

  return "";
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return "";
}

export function describeInboundPayloadShape(event: XvcEvent<InboundMessagePayload>): string {
  const payload = event.payload as InboundPayloadRecord;
  const keys = Object.keys(payload).sort();
  const stringFields = keys
    .filter((key) => typeof payload[key] === "string")
    .map((key) => `${key}:${(payload[key] as string).length}`);
  const metadataKeys = Object.keys(readRecord(payload.metadata)).sort();
  const nestedObjectKeys = keys.filter((key) => {
    const value = payload[key];
    return value && typeof value === "object" && !Array.isArray(value);
  });

  return [
    `event_id=${event.event_id}`,
    `message_id=${readString(payload.message_id) || "(missing)"}`,
    `keys=${keys.length ? keys.join(",") : "(none)"}`,
    `stringFields=${stringFields.length ? stringFields.join(",") : "(none)"}`,
    `metadataKeys=${metadataKeys.length ? metadataKeys.join(",") : "(none)"}`,
    `nestedObjectKeys=${nestedObjectKeys.length ? nestedObjectKeys.join(",") : "(none)"}`,
  ].join(" ");
}

export function parseInboundMessage(event: XvcEvent<InboundMessagePayload>): InboundMessage | null {
  const payload = event.payload as InboundPayloadRecord;
  const metadata = readRecord(payload.metadata);
  const text = readInboundText(payload);

  if (!text) {
    return null;
  }

  const sessionId = readFirstString(payload.session_id, payload.sessionId, metadata.session_id, metadata.sessionId);
  const agentBindingId = readFirstString(
    payload.agent_binding_id,
    payload.agentBindingId,
    metadata.agent_binding_id,
    metadata.agentBindingId,
  );
  const conversationId = readFirstString(payload.chat_id, payload.conversation_id, payload.conversationId, sessionId);

  return {
    id: payload.message_id,
    ...(sessionId ? { sessionId } : {}),
    ...(agentBindingId ? { agentBindingId } : {}),
    type: "text",
    text,
    sender: {
      id: payload.sender.id,
      name: payload.sender.name,
    },
    conversationId,
    conversationType: payload.chat_type === "room" ? "group" : "direct",
    timestamp: event.created_at,
    raw: payload,
  };
}
