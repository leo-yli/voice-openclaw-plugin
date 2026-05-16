import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgo_voice.token": "t",
    "channels.xalgo_voice.instanceId": "oc_test",
    "channels.xalgo_voice.boundAt": "ts",
    "channels.xalgo_voice.boundUserId": "u_1",
  };
  return { store: createBindingStore({ read: async (k) => data[k], write: async (k, v) => { data[k] = v; } }), data };
}

describe("XvcClient auth_failed reasons", () => {
  it("binding_revoked → status auth_failed, disable reconnect, emit control event", () => {
    const { store } = makeStore();
    const onControlEvent = vi.fn();
    const onStatusChange = vi.fn();
    const client = new XvcClient(
      resolveConfig({ token: "t" }),
      { onEvent: () => {}, onStatusChange, onControlEvent },
      store
    );

    (client as any).handleErrorEvent({
      code: "AUTH_FAILED",
      message: "binding revoked",
      reason: "binding_revoked",
    });

    expect(onStatusChange).toHaveBeenCalledWith("auth_failed");
    expect((client as any).reconnectDisabled).toBe(true);
  });

  it("instance_mismatch → emit dedicated warning + status auth_failed", () => {
    const { store } = makeStore();
    const onStatusChange = vi.fn();
    const onControlEvent = vi.fn();
    const client = new XvcClient(
      resolveConfig({ token: "t" }),
      { onEvent: () => {}, onStatusChange, onControlEvent },
      store
    );

    (client as any).handleErrorEvent({
      code: "AUTH_FAILED",
      message: "instance mismatch",
      reason: "instance_mismatch",
    });

    expect(onStatusChange).toHaveBeenCalledWith("auth_failed");
    expect((client as any).reconnectDisabled).toBe(true);
    expect(onControlEvent).toHaveBeenCalled();
    const evt = onControlEvent.mock.calls[0][0];
    expect(evt.type).toBe("binding_revoked");
    expect(evt.payload.reason).toBe("suspicious_activity");
  });
});
