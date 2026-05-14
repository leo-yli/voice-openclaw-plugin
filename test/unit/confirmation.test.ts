import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfirmationManager } from "../../src/confirmation.js";
import type { ConfirmationRequestPayload, ConfirmationResponsePayload } from "../../src/protocol.js";

describe("ConfirmationManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a pending confirmation", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_001",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_001",
      text: "确认发送吗？",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice", "phone_card"],
    };

    mgr.addPending(request);
    expect(mgr.hasPending("conf_001")).toBe(true);
    expect(mgr.getPending("conf_001")).toEqual(request);
  });

  it("resolves a confirmation with confirmed", () => {
    const mgr = new ConfirmationManager();
    const onResolve = vi.fn();
    mgr.onResolve(onResolve);

    mgr.addPending({
      confirmation_id: "conf_001",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_001",
      text: "确认发送吗？",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });

    const response: ConfirmationResponsePayload = {
      confirmation_id: "conf_001",
      chat_id: "xalgo:user:u123",
      result: "confirmed",
      text: "确认",
      asr_confidence: 0.95,
      method: "voice",
    };

    mgr.resolve(response);
    expect(mgr.hasPending("conf_001")).toBe(false);
    expect(onResolve).toHaveBeenCalledWith(response);
  });

  it("auto-expires pending confirmation", () => {
    const mgr = new ConfirmationManager();
    const onResolve = vi.fn();
    mgr.onResolve(onResolve);

    const expiresAt = Date.now() + 30000;
    mgr.addPending({
      confirmation_id: "conf_002",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_002",
      text: "确认？",
      risk_level: "R2",
      expires_at: expiresAt,
      confirm_methods: ["voice"],
    });

    vi.advanceTimersByTime(31000);

    expect(mgr.hasPending("conf_002")).toBe(false);
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ confirmation_id: "conf_002", result: "timeout" })
    );
  });

  it("rejects R3 with voice-only method", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_003",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_003",
      text: "删除所有数据？",
      risk_level: "R3",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    };

    const result = mgr.validateRequest(request, { allowPureVoiceR3: false });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("R3");
  });

  it("allows R3 with phone_card method", () => {
    const mgr = new ConfirmationManager();
    const request: ConfirmationRequestPayload = {
      confirmation_id: "conf_004",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_004",
      text: "删除所有数据？",
      risk_level: "R3",
      expires_at: Date.now() + 60000,
      confirm_methods: ["phone_card"],
    };

    const result = mgr.validateRequest(request, { allowPureVoiceR3: false });
    expect(result.valid).toBe(true);
  });

  it("cleanup removes all pending confirmations", () => {
    const mgr = new ConfirmationManager();
    mgr.addPending({
      confirmation_id: "conf_a",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_a",
      text: "a?",
      risk_level: "R1",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });
    mgr.addPending({
      confirmation_id: "conf_b",
      chat_id: "xalgo:user:u123",
      reply_to: "msg_b",
      text: "b?",
      risk_level: "R2",
      expires_at: Date.now() + 60000,
      confirm_methods: ["voice"],
    });

    mgr.cleanup();
    expect(mgr.hasPending("conf_a")).toBe(false);
    expect(mgr.hasPending("conf_b")).toBe(false);
  });
});
