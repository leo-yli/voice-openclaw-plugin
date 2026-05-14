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
