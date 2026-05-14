import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "../../src/inbound.js";
import type { XvcEvent, InboundMessagePayload } from "../../src/protocol.js";

describe("inbound", () => {
  const makeEvent = (payload: InboundMessagePayload): XvcEvent<InboundMessagePayload> => ({
    event_id: "evt_001",
    type: "inbound_message",
    created_at: 1718000000000,
    idempotency_key: "idem_001",
    payload,
  });

  it("converts inbound_message to OpenClaw InboundMessage", () => {
    const event = makeEvent({
      message_id: "msg_001",
      chat_id: "xalgo:user:u123",
      chat_type: "direct",
      sender: { id: "u123", name: "杨立" },
      text: "帮我看看今天有什么待办",
      metadata: {
        input_type: "voice",
        language: "zh-CN",
        asr_confidence: 0.93,
        device_id: "glasses_abc",
        wake_source: "wake_word",
        duplex_session_id: "duplex_789",
      },
    });

    const result = parseInboundMessage(event);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("msg_001");
    expect(result!.text).toBe("帮我看看今天有什么待办");
    expect(result!.sender.id).toBe("u123");
    expect(result!.sender.name).toBe("杨立");
    expect(result!.conversationId).toBe("xalgo:user:u123");
    expect(result!.conversationType).toBe("direct");
    expect(result!.timestamp).toBe(1718000000000);
    expect(result!.raw).toBe(event.payload);
  });

  it("handles missing optional metadata fields", () => {
    const event = makeEvent({
      message_id: "msg_002",
      chat_id: "xalgo:user:u456",
      chat_type: "direct",
      sender: { id: "u456", name: "Test" },
      text: "hello",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("hello");
  });

  it("returns null for empty text", () => {
    const event = makeEvent({
      message_id: "msg_003",
      chat_id: "xalgo:user:u789",
      chat_type: "direct",
      sender: { id: "u789", name: "Test" },
      text: "",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).toBeNull();
  });
});
