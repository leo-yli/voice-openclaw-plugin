import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgoVoice.token": "t",
    "channels.xalgoVoice.instanceId": "oc_test",
    "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
    "channels.xalgoVoice.boundUserId": "u_1",
  };
  return createBindingStore({
    read: async (k) => data[k],
    write: async (k, v) => {
      data[k] = v;
    },
  });
}

describe("XvcClient dispatch: control_event", () => {
  it("invokes onControlEvent for binding_revoked", async () => {
    const onControlEvent = vi.fn();
    const cfg = resolveConfig({ token: "t" });
    const store = makeStore();
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {}, onControlEvent },
      store
    );

    const evt = createEvent("binding_revoked", {
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "ts",
    });
    (client as any).dispatchControlEvent(evt);

    expect(onControlEvent).toHaveBeenCalledOnce();
    expect(onControlEvent.mock.calls[0][0].type).toBe("binding_revoked");
  });

  it("disableReconnect prevents future scheduleReconnect from running", () => {
    const cfg = resolveConfig({ token: "t" });
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      makeStore()
    );
    client.disableReconnect();
    expect((client as any).reconnectDisabled).toBe(true);
  });
});
