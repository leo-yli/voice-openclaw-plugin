import { describe, it, expect } from "vitest";
import { formatOutboundMessage, formatOutboundDelta } from "../../src/outbound.js";

describe("outbound", () => {
  it("formats a complete reply as outbound_message", () => {
    const result = formatOutboundMessage({
      messageId: "reply_001",
      sessionId: "voice_session_001",
      agentBindingId: "agent_binding_001",
      chatId: "museve:user:u123",
      replyTo: "msg_001",
      text: "你今天有三个待办",
      replyMode: "voice_first",
    });

    expect(result.type).toBe("outbound_message");
    expect(result.payload.message_id).toBe("reply_001");
    expect(result.payload.session_id).toBe("voice_session_001");
    expect(result.payload.agent_binding_id).toBe("agent_binding_001");
    expect(result.payload.chat_id).toBe("museve:user:u123");
    expect(result.payload.reply_to).toBe("msg_001");
    expect(result.payload.text).toBe("你今天有三个待办");
    expect(result.payload.risk_state).toBe("R0");
    expect(result.payload.is_final).toBe(true);
    expect(result.payload.metadata.speak).toBe(true);
    expect(result.payload.metadata.output_type).toBe("voice_preferred");
  });

  it("formats text_first reply mode", () => {
    const result = formatOutboundMessage({
      messageId: "reply_002",
      chatId: "museve:user:u123",
      replyTo: "msg_002",
      text: "hello",
      replyMode: "text_first",
    });

    expect(result.payload.metadata.output_type).toBe("text_preferred");
    expect(result.payload.metadata.speak).toBe(false);
  });

  it("formats a streaming delta", () => {
    const result = formatOutboundDelta({
      messageId: "reply_001",
      sessionId: "voice_session_001",
      agentBindingId: "agent_binding_001",
      chatId: "museve:user:u123",
      deltaSeq: 3,
      textDelta: "三个待办",
      spanId: "span_001",
      isFinal: false,
    });

    expect(result.type).toBe("outbound_delta");
    expect(result.payload.message_id).toBe("reply_001");
    expect(result.payload.session_id).toBe("voice_session_001");
    expect(result.payload.agent_binding_id).toBe("agent_binding_001");
    expect(result.payload.delta_seq).toBe(3);
    expect(result.payload.text_delta).toBe("三个待办");
    expect(result.payload.risk_state).toBe("R0");
    expect(result.payload.span_id).toBe("span_001");
    expect(result.payload.is_final).toBe(false);
  });

  it("formats final delta", () => {
    const result = formatOutboundDelta({
      messageId: "reply_001",
      chatId: "museve:user:u123",
      deltaSeq: 10,
      textDelta: "",
      spanId: "span_001",
      isFinal: true,
    });

    expect(result.payload.is_final).toBe(true);
  });
});
