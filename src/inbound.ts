import type { XvcEvent, InboundMessagePayload, VoiceUserTurnPayload } from "./protocol.js";

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
  raw: InboundMessagePayload | VoiceUserTurnPayload;
}

type InboundPayloadRecord = Partial<InboundMessagePayload & VoiceUserTurnPayload> & Record<string, unknown>;

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
    "user_text",
    "userText",
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

export function describeInboundPayloadShape(event: XvcEvent<InboundMessagePayload | VoiceUserTurnPayload>): string {
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

export function parseInboundMessage(event: XvcEvent<InboundMessagePayload | VoiceUserTurnPayload>): InboundMessage | null {
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
  const messageId = readFirstString(payload.message_id, payload.messageId, payload.utterance_id, payload.utteranceId, event.event_id);
  const conversationId = readFirstString(payload.chat_id, payload.conversation_id, payload.conversationId, sessionId, agentBindingId, messageId);
  const sender = readRecord(payload.sender);
  const senderId = readFirstString(sender.id, payload.user_id, payload.userId, payload.sender_id, payload.senderId, conversationId.split(":").pop(), "voice_user");
  const senderName = readFirstString(sender.name, payload.user_name, payload.userName, "User");
  const chatType = readFirstString(payload.chat_type, payload.chatType, payload.conversation_type, payload.conversationType);

  return {
    id: messageId,
    ...(sessionId ? { sessionId } : {}),
    ...(agentBindingId ? { agentBindingId } : {}),
    type: "text",
    text,
    sender: {
      id: senderId,
      name: senderName,
    },
    conversationId,
    conversationType: chatType === "room" || chatType === "group" ? "group" : "direct",
    timestamp: event.created_at,
    raw: payload as InboundMessagePayload | VoiceUserTurnPayload,
  };
}
