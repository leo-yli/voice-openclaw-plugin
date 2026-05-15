import { describe, it, expect, beforeEach } from "vitest";
import { createBindingStore, type BindingState } from "../../src/binding-store.js";

function makeMemoryAdapter() {
  const data: Record<string, unknown> = {};
  return {
    storage: data,
    read: async (key: string) => data[key],
    write: async (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

describe("BindingStore", () => {
  let adapter: ReturnType<typeof makeMemoryAdapter>;

  beforeEach(() => {
    adapter = makeMemoryAdapter();
  });

  it("read returns null when no binding exists", async () => {
    const store = createBindingStore(adapter);
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("write then read returns the full state", async () => {
    const store = createBindingStore(adapter);
    const state: BindingState = {
      token: "xvc_live_abc",
      instanceId: "oc_uuid1",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "user_1",
      boundUserName: "杨立",
      deviceLabel: "OpenClaw on host",
    };
    await store.write(state);
    expect(await store.read()).toEqual(state);
    expect(await store.isBound()).toBe(true);
  });

  it("updateToken only changes the token field", async () => {
    const store = createBindingStore(adapter);
    await store.write({
      token: "old",
      instanceId: "oc_uuid1",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "user_1",
    });
    await store.updateToken("new");
    const after = await store.read();
    expect(after?.token).toBe("new");
    expect(after?.instanceId).toBe("oc_uuid1");
    expect(after?.boundUserId).toBe("user_1");
  });

  it("clear removes all binding fields", async () => {
    const store = createBindingStore(adapter);
    await store.write({
      token: "t",
      instanceId: "i",
      boundAt: "2026-05-15T00:00:00Z",
      boundUserId: "u",
    });
    await store.clear();
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("partial data (missing required fields) is treated as unbound", async () => {
    adapter.storage["channels.xalgoVoice.token"] = "t";
    // 缺 instanceId
    const store = createBindingStore(adapter);
    expect(await store.read()).toBeNull();
    expect(await store.isBound()).toBe(false);
  });

  it("updateToken throws when not yet bound", async () => {
    const store = createBindingStore(adapter);
    await expect(store.updateToken("new")).rejects.toThrow(/no binding/i);
  });
});
