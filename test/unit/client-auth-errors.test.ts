import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.museve_voice.token": "t",
    "channels.museve_voice.instanceId": "oc_test",
    "channels.museve_voice.boundAt": "ts",
    "channels.museve_voice.boundUserId": "u_1",
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

  it("resume protocol_error falls back to a fresh connect instead of disabling reconnect", () => {
    const { store } = makeStore();
    const onStatusChange = vi.fn();
    const onControlEvent = vi.fn();
    const client = new XvcClient(
      resolveConfig({ token: "t" }),
      { onEvent: () => {}, onStatusChange, onControlEvent },
      store
    );
    const terminate = vi.fn();
    (client as any).status = "connected";
    (client as any).ws = { readyState: 1, terminate };
    (client as any).reconnect.recordConnectionId("conn_old");
    (client as any).reconnect.recordEventId("evt_old");
    (client as any).scheduleReconnect = vi.fn();

    (client as any).handleErrorEvent({
      code: "AUTH_FAILED",
      message: "first frame must be connect",
      reason: "protocol_error",
    });

    expect(onStatusChange).toHaveBeenCalledWith("disconnected");
    expect((client as any).reconnectDisabled).toBe(false);
    expect((client as any).reconnect.connectionId).toBeNull();
    expect((client as any).reconnect.lastEventId).toBeNull();
    expect(terminate).toHaveBeenCalledOnce();
    expect((client as any).scheduleReconnect).toHaveBeenCalledOnce();
    expect(onControlEvent).not.toHaveBeenCalled();
  });
});
