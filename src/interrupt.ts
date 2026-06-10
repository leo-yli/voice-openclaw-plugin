import { createLogger } from "./logger.js";
import type { XvcEvent, VoiceCancelRequestPayload, VoiceInterruptPayload } from "./protocol.js";
import type { InboundMessage } from "./inbound.js";

const log = createLogger("interrupt");

export interface PlaybackLedger {
  messageId: string;
  deliveredText: string;
  notDelivered: boolean;
  playedUntil: { span_id: string; chunk_seq: number };
}

export interface VoiceCancelRequest {
  eventId: string;
  sessionId?: string;
  agentBindingId?: string;
  utteranceId?: string;
  chatId?: string;
  reason?: string;
  text: string;
  raw: VoiceCancelRequestPayload;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class InterruptHandler {
  private ledgers = new Map<string, PlaybackLedger>();
  private cancelCallback: ((messageId: string) => void) | null = null;

  onCancelRun(callback: (messageId: string) => void): void {
    this.cancelCallback = callback;
  }

  handleInterrupt(event: XvcEvent<VoiceInterruptPayload>): InboundMessage | null {
    const { payload } = event;
    const interruptedMessageId = readString(payload.interrupted_message_id) || event.event_id;
    const sessionId = readString(payload.session_id);
    const agentBindingId = readString(payload.agent_binding_id);
    const chatId = readString(payload.chat_id) || sessionId || agentBindingId || event.event_id;
    const text = readString(payload.text) || readString(payload.user_text);

    log.info(`Interrupt received: msg=${interruptedMessageId}, decision=${payload.decision}`);

    this.ledgers.set(interruptedMessageId, {
      messageId: interruptedMessageId,
      deliveredText: payload.ledger_summary?.delivered_text ?? "",
      notDelivered: payload.ledger_summary?.not_delivered ?? true,
      playedUntil: payload.played_until ?? { span_id: "", chunk_seq: 0 },
    });

    this.cancelCallback?.(interruptedMessageId);

    if (!text) {
      return null;
    }

    const followUp: InboundMessage = {
      id: `interrupt_${event.event_id}`,
      ...(sessionId ? { sessionId } : {}),
      ...(agentBindingId ? { agentBindingId } : {}),
      type: "text",
      text,
      sender: { id: chatId.split(":").pop() ?? "unknown", name: "User" },
      conversationId: chatId,
      conversationType: "direct",
      timestamp: event.created_at,
      replyToId: interruptedMessageId,
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

export function parseVoiceCancelRequest(event: XvcEvent<VoiceCancelRequestPayload>): VoiceCancelRequest {
  const payload = event.payload;
  return {
    eventId: event.event_id,
    ...(readString(payload.session_id) ? { sessionId: readString(payload.session_id) } : {}),
    ...(readString(payload.agent_binding_id) ? { agentBindingId: readString(payload.agent_binding_id) } : {}),
    ...(readString(payload.utterance_id) ? { utteranceId: readString(payload.utterance_id) } : {}),
    ...(readString(payload.chat_id) || readString(payload.conversation_id)
      ? { chatId: readString(payload.chat_id) || readString(payload.conversation_id) }
      : {}),
    ...(readString(payload.reason) ? { reason: readString(payload.reason) } : {}),
    text: readString(payload.user_text) || readString(payload.text),
    raw: payload,
  };
}
