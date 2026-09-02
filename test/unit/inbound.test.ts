import { describe, it, expect } from "vitest";
import { parseInboundMessage } from "../../src/inbound.js";
import type { XvcEvent, InboundMessagePayload, VoiceUserTurnPayload } from "../../src/protocol.js";

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
      session_id: "voice_session_001",
      agent_binding_id: "agent_binding_001",
      chat_id: "museve:user:u123",
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
    expect(result!.sessionId).toBe("voice_session_001");
    expect(result!.agentBindingId).toBe("agent_binding_001");
    expect(result!.text).toBe("帮我看看今天有什么待办");
    expect(result!.sender.id).toBe("u123");
    expect(result!.sender.name).toBe("杨立");
    expect(result!.conversationId).toBe("museve:user:u123");
    expect(result!.conversationType).toBe("direct");
    expect(result!.timestamp).toBe(1718000000000);
    expect(result!.raw).toBe(event.payload);
  });

  it("handles missing optional metadata fields", () => {
    const event = makeEvent({
      message_id: "msg_002",
      chat_id: "museve:user:u456",
      chat_type: "direct",
      sender: { id: "u456", name: "Test" },
      text: "hello",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("hello");
  });

  it("accepts common ASR transcript field names", () => {
    const event = makeEvent({
      message_id: "msg_004",
      chat_id: "museve:user:u456",
      chat_type: "direct",
      sender: { id: "u456", name: "Test" },
      text: "",
      transcript: "从 transcript 来的语音文本",
      metadata: { input_type: "voice" },
    } as InboundMessagePayload);

    const result = parseInboundMessage(event);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("从 transcript 来的语音文本");
  });

  it("accepts nested ASR result text", () => {
    const event = makeEvent({
      message_id: "msg_005",
      chat_id: "museve:user:u456",
      chat_type: "direct",
      sender: { id: "u456", name: "Test" },
      text: "",
      result: { text: "从 result.text 来的语音文本" },
      metadata: { input_type: "voice" },
    } as InboundMessagePayload);

    const result = parseInboundMessage(event);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("从 result.text 来的语音文本");
  });

  it("converts PUPA voice.user_turn without legacy chat fields", () => {
    const event: XvcEvent<VoiceUserTurnPayload> = {
      event_id: "evt_turn_001",
      type: "voice.user_turn",
      created_at: 1718000000000,
      idempotency_key: "idem_turn_001",
      payload: {
        session_id: "voice_session_test",
        agent_binding_id: "agent_binding_test",
        utterance_id: "utt_001",
        user_text: "测试一下语音路由",
        metadata: { input_type: "voice" },
      },
    };

    const result = parseInboundMessage(event);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("utt_001");
    expect(result!.sessionId).toBe("voice_session_test");
    expect(result!.agentBindingId).toBe("agent_binding_test");
    expect(result!.conversationId).toBe("voice_session_test");
    expect(result!.text).toBe("测试一下语音路由");
  });

  it("returns null for empty text", () => {
    const event = makeEvent({
      message_id: "msg_003",
      chat_id: "museve:user:u789",
      chat_type: "direct",
      sender: { id: "u789", name: "Test" },
      text: "",
      metadata: { input_type: "voice" },
    });

    const result = parseInboundMessage(event);
    expect(result).toBeNull();
  });
});
