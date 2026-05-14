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
      chat_id: "xalgo:user:u123",
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
    expect(result!.conversationId).toBe("xalgo:user:u123");
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
