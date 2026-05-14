import { describe, it, expect } from "vitest";
import { parseEvent, isValidEvent, type XvcEvent } from "../../src/protocol.js";

describe("protocol", () => {
  it("parses a valid inbound_message event", () => {
    const raw = JSON.stringify({
      event_id: "evt_001",
      type: "inbound_message",
      created_at: 1718000000000,
      idempotency_key: "idem_001",
      payload: {
        message_id: "msg_001",
        chat_id: "xalgo:user:u123",
        chat_type: "direct",
        sender: { id: "u123", name: "Test" },
        text: "hello",
        metadata: { input_type: "voice", language: "zh-CN", asr_confidence: 0.9 },
      },
    });
    const event = parseEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("inbound_message");
    expect(event!.event_id).toBe("evt_001");
  });

  it("returns null for malformed JSON", () => {
    expect(parseEvent("not json")).toBeNull();
  });

  it("returns null for missing required fields", () => {
    const raw = JSON.stringify({ type: "inbound_message" });
    expect(parseEvent(raw)).toBeNull();
  });

  it("validates event structure", () => {
    const valid: XvcEvent = {
      event_id: "evt_002",
      type: "ping",
      created_at: 1718000000000,
      idempotency_key: "idem_002",
      payload: { ts: 1718000000000 },
    };
    expect(isValidEvent(valid)).toBe(true);
  });

  it("rejects event without event_id", () => {
    const invalid = { type: "ping", created_at: 123, payload: {} } as any;
    expect(isValidEvent(invalid)).toBe(false);
  });
});
