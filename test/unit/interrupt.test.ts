import { describe, it, expect, vi } from "vitest";
import { InterruptHandler, parseVoiceCancelRequest } from "../../src/interrupt.js";
import type { XvcEvent, VoiceCancelRequestPayload, VoiceInterruptPayload } from "../../src/protocol.js";

describe("InterruptHandler", () => {
  const makeInterruptEvent = (overrides?: Partial<VoiceInterruptPayload>): XvcEvent<VoiceInterruptPayload> => ({
    event_id: "evt_int_001",
    type: "voice_interrupt",
    created_at: Date.now(),
    idempotency_key: "idem_int_001",
    payload: {
      chat_id: "xalgo:user:u123",
      session_id: "voice_session_test",
      agent_binding_id: "agent_binding_test",
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
    expect(result!.sessionId).toBe("voice_session_test");
    expect(result!.agentBindingId).toBe("agent_binding_test");
    expect(result!.replyToId).toBe("reply_001");
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

  it("parses voice cancel_request payload", () => {
    const event: XvcEvent<VoiceCancelRequestPayload> = {
      event_id: "evt_cancel_001",
      type: "voice.cancel_request",
      created_at: Date.now(),
      idempotency_key: "idem_cancel_001",
      payload: {
        session_id: "voice_session_test",
        agent_binding_id: "agent_binding_test",
        utterance_id: "utt_001",
        reason: "user_voice_cancel",
        user_text: "Never mind, cancel that task.",
        turn_state: "CANCEL",
        metadata: { input_type: "voice" },
      },
    };

    const result = parseVoiceCancelRequest(event);

    expect(result.sessionId).toBe("voice_session_test");
    expect(result.agentBindingId).toBe("agent_binding_test");
    expect(result.utteranceId).toBe("utt_001");
    expect(result.text).toBe("Never mind, cancel that task.");
  });
});
