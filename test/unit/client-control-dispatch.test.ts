import { describe, it, expect, vi } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.museve_voice.token": "t",
    "channels.museve_voice.instanceId": "oc_test",
    "channels.museve_voice.boundAt": "2026-05-15T00:00:00Z",
    "channels.museve_voice.boundUserId": "u_1",
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

  it("disconnect is terminal and close does not schedule a reconnect", () => {
    const cfg = resolveConfig({ token: "t" });
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      makeStore()
    );
    const close = vi.fn();
    const reconnectSchedule = vi.fn();
    (client as any).status = "connected";
    (client as any).ws = { close };
    (client as any).reconnect.schedule = reconnectSchedule;

    client.disconnect();
    (client as any).handleClose({ close: vi.fn() }, 0, 1000, "client disconnect");

    expect((client as any).reconnectDisabled).toBe(true);
    expect(close).toHaveBeenCalledWith(1000, "client disconnect");
    expect(reconnectSchedule).not.toHaveBeenCalled();
  });

  it("responds to server ping with pong without dispatching it as inbound business event", () => {
    const cfg = resolveConfig({ token: "t" });
    const onEvent = vi.fn();
    const onTransportActivity = vi.fn();
    const client = new XvcClient(
      cfg,
      { onEvent, onStatusChange: () => {}, onTransportActivity },
      makeStore()
    );
    const send = vi.fn();
    (client as any).ws = { readyState: 1, send };

    (client as any).handleMessage(JSON.stringify(createEvent("ping", { ts: 123 })));

    expect(onEvent).not.toHaveBeenCalled();
    expect(onTransportActivity).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    const sent = JSON.parse(send.mock.calls[0][0]);
    expect(sent.type).toBe("pong");
    expect(sent.payload.ts).toBe(123);
  });

  it("ignores close events from an obsolete socket", () => {
    const cfg = resolveConfig({ token: "t" });
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      makeStore()
    );
    const oldWs = { close: vi.fn() };
    const currentWs = { close: vi.fn() };
    (client as any).ws = currentWs;
    (client as any).connectionGeneration = 2;
    (client as any).status = "connected";
    const scheduleReconnect = vi.fn();
    (client as any).scheduleReconnect = scheduleReconnect;

    (client as any).handleClose(oldWs, 1, 1006, "stale");

    expect((client as any).ws).toBe(currentWs);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it("terminates a half-open socket and schedules exactly one heartbeat reconnect", () => {
    vi.useFakeTimers();
    const cfg = resolveConfig({ token: "t" });
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      makeStore()
    );
    const ws = { readyState: 1, terminate: vi.fn() };
    (client as any).ws = ws;
    (client as any).connectionGeneration = 1;
    (client as any).status = "connected";
    const scheduleReconnect = vi.fn();
    (client as any).scheduleReconnect = scheduleReconnect;

    (client as any).forceReconnect("heartbeat timeout");

    expect(ws.terminate).toHaveBeenCalledOnce();
    expect((client as any).ws).toBeNull();
    expect(scheduleReconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
