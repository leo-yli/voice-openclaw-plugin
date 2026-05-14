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
