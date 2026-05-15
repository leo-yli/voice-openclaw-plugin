import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createControlEventHandler } from "../../src/control-events.js";
import type { BindingStore } from "../../src/binding-store.js";
import type { RestClient } from "../../src/rest-client.js";

function makeBindingStore(initial?: { token: string; instanceId: string }): BindingStore {
  let state = initial
    ? {
        token: initial.token,
        instanceId: initial.instanceId,
        boundAt: "2026-05-15T00:00:00Z",
        boundUserId: "u_1",
      }
    : null;
  return {
    read: async () => state,
    write: async (s) => {
      state = s;
    },
    updateToken: async (t) => {
      if (state) state.token = t;
    },
    clear: async () => {
      state = null;
    },
    isBound: async () => state !== null,
  };
}

function makeRestClient(behaviors: Partial<RestClient> = {}): RestClient {
  return {
    exchange: vi.fn(),
    rotate: vi.fn().mockResolvedValue({ channelToken: "new_token" }),
    unbind: vi.fn(),
    ...behaviors,
  } as unknown as RestClient;
}

describe("control-events: binding_revoked", () => {
  it("clears local binding and calls onBindingLost", async () => {
    const store = makeBindingStore({ token: "t", instanceId: "i" });
    const restClient = makeRestClient();
    const onBindingLost = vi.fn();
    const disableReconnect = vi.fn();

    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost,
      disableReconnect,
    });

    await handler.handleBindingRevoked({
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "2026-05-15T00:00:00Z",
    });

    expect(disableReconnect).toHaveBeenCalled();
    expect(await store.isBound()).toBe(false);
    expect(onBindingLost).toHaveBeenCalledWith("user_unbound");
  });

  it("is idempotent: handling twice with same event_id is no-op", async () => {
    const store = makeBindingStore({ token: "t", instanceId: "i" });
    const onBindingLost = vi.fn();
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient: makeRestClient(),
      onBindingLost,
      disableReconnect: vi.fn(),
    });

    await handler.handleBindingRevoked(
      { binding_id: "b_1", reason: "user_unbound", revoked_at: "ts" },
      "evt_dup"
    );
    await handler.handleBindingRevoked(
      { binding_id: "b_1", reason: "user_unbound", revoked_at: "ts" },
      "evt_dup"
    );
    expect(onBindingLost).toHaveBeenCalledTimes(1);
  });
});

describe("control-events: token_rotated_notify", () => {
  it("calls restClient.rotate and updates token via store", async () => {
    const store = makeBindingStore({ token: "old", instanceId: "i" });
    const rotate = vi.fn().mockResolvedValue({ channelToken: "new" });
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect(rotate).toHaveBeenCalledWith("old", "i");
    expect((await store.read())?.token).toBe("new");
  });

  it("leaves old token when rotate fails", async () => {
    const store = makeBindingStore({ token: "old", instanceId: "i" });
    const rotate = vi.fn().mockRejectedValue(new Error("server_error"));
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect((await store.read())?.token).toBe("old");
  });

  it("skips rotate when no binding exists (already revoked locally)", async () => {
    const store = makeBindingStore();
    const rotate = vi.fn();
    const restClient = makeRestClient({ rotate });
    const handler = createControlEventHandler({
      bindingStore: store,
      restClient,
      onBindingLost: vi.fn(),
      disableReconnect: vi.fn(),
    });

    await handler.handleTokenRotatedNotify({
      binding_id: "b_1",
      request_id: "req_1",
      initiated_by: "user",
      grace_period_sec: 60,
    });

    expect(rotate).not.toHaveBeenCalled();
  });
});
