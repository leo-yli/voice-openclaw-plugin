import { createEvent, type XvcEvent, type OutboundMessagePayload, type OutboundDeltaPayload } from "./protocol.js";

export interface OutboundMessageOptions {
  messageId: string;
  sessionId?: string;
  agentBindingId?: string;
  chatId: string;
  replyTo: string;
  text: string;
  riskState?: "R0" | "R1" | "R2" | "R3";
  isFinal?: boolean;
  replyMode: "voice_first" | "text_first" | "both";
  priority?: "normal" | "urgent";
  phonePush?: boolean;
}

export interface OutboundDeltaOptions {
  messageId: string;
  sessionId?: string;
  agentBindingId?: string;
  chatId: string;
  deltaSeq: number;
  textDelta: string;
  spanId: string;
  riskState?: "R0" | "R1" | "R2" | "R3";
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
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    ...(opts.agentBindingId ? { agent_binding_id: opts.agentBindingId } : {}),
    chat_id: opts.chatId,
    reply_to: opts.replyTo,
    text: opts.text,
    risk_state: opts.riskState ?? "R0",
    is_final: opts.isFinal ?? true,
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
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    ...(opts.agentBindingId ? { agent_binding_id: opts.agentBindingId } : {}),
    chat_id: opts.chatId,
    delta_seq: opts.deltaSeq,
    text_delta: opts.textDelta,
    risk_state: opts.riskState ?? "R0",
    span_id: opts.spanId,
    is_final: opts.isFinal,
  };

  return createEvent("outbound_delta", payload);
}
