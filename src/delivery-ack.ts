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
