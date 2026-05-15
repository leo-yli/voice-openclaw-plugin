import { describe, it, expect } from "vitest";
import { parseEvent, type XvcEvent, type BindingRevokedPayload, type TokenRotatedNotifyPayload } from "../../src/protocol.js";

describe("protocol: control events", () => {
  it("parses binding_revoked event", () => {
    const raw = JSON.stringify({
      event_id: "evt_1",
      type: "binding_revoked",
      created_at: 1700000000000,
      idempotency_key: "idem_1",
      payload: {
        binding_id: "b_1",
        reason: "user_unbound",
        revoked_at: "2026-05-15T00:00:00Z",
      },
    });
    const event = parseEvent(raw) as XvcEvent<BindingRevokedPayload> | null;
    expect(event).not.toBeNull();
    expect(event!.type).toBe("binding_revoked");
    expect(event!.payload.reason).toBe("user_unbound");
  });

  it("parses token_rotated_notify event", () => {
    const raw = JSON.stringify({
      event_id: "evt_2",
      type: "token_rotated_notify",
      created_at: 1700000000000,
      idempotency_key: "idem_2",
      payload: {
        binding_id: "b_1",
        request_id: "req_1",
        initiated_by: "user",
        grace_period_sec: 60,
      },
    });
    const event = parseEvent(raw) as XvcEvent<TokenRotatedNotifyPayload> | null;
    expect(event).not.toBeNull();
    expect(event!.type).toBe("token_rotated_notify");
    expect(event!.payload.grace_period_sec).toBe(60);
  });
});
