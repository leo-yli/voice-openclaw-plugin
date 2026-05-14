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
