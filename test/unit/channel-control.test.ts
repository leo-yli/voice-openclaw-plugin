import { describe, it, expect, vi } from "vitest";
import { XalgoVoiceChannel } from "../../src/channel.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.xalgo_voice.token": "t",
    "channels.xalgo_voice.instanceId": "oc_test",
    "channels.xalgo_voice.boundAt": "2026-05-15T00:00:00Z",
    "channels.xalgo_voice.boundUserId": "u_1",
  };
  return {
    store: createBindingStore({
      read: async (k) => data[k],
      write: async (k, v) => {
        data[k] = v;
      },
    }),
    data,
  };
}

describe("XalgoVoiceChannel + control events", () => {
  it("on binding_revoked: clears local binding and emits unbound status", async () => {
    const { store, data } = makeStore();
    const statusUpdates: string[] = [];

    const channel = new XalgoVoiceChannel(
      { token: "t", apiBaseUrl: "https://api.example.com" } as any,
      store
    );

    await channel.start({
      handleMessage: () => {},
      handleStatus: (s) => statusUpdates.push(s.status),
    });

    const evt = createEvent("binding_revoked", {
      binding_id: "b_1",
      reason: "user_unbound",
      revoked_at: "ts",
    });

    (channel as any).client.dispatchControlEvent(evt);

    await new Promise((r) => setTimeout(r, 50));

    expect(data["channels.xalgo_voice.token"]).toBe("");
    expect(statusUpdates).toContain("unbound");

    await channel.stop();
  });
});
