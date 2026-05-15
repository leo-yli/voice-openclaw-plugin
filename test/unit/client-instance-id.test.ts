import { describe, it, expect } from "vitest";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import type { BindingStore } from "../../src/binding-store.js";

function makeBindingStoreStub(instanceId: string): BindingStore {
  return {
    read: async () => ({
      token: "xvc_live_t",
      instanceId,
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "u_1",
    }),
    write: async () => {},
    updateToken: async () => {},
    clear: async () => {},
    isBound: async () => true,
  };
}

describe("XvcClient.instanceId injection", () => {
  it("uses instance_id from binding store, not random fallback", async () => {
    const cfg = resolveConfig({ token: "t" });
    const store = makeBindingStoreStub("oc_550e8400-e29b-41d4-a716-446655440000");
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      store
    );

    const id = await client.getInstanceId();
    expect(id).toBe("oc_550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null when binding store has no binding", async () => {
    const cfg = resolveConfig({ token: "" });
    const store: BindingStore = {
      read: async () => null,
      write: async () => {},
      updateToken: async () => {},
      clear: async () => {},
      isBound: async () => false,
    };
    const client = new XvcClient(
      cfg,
      { onEvent: () => {}, onStatusChange: () => {} },
      store
    );
    expect(await client.getInstanceId()).toBeNull();
  });
});
