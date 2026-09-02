import { describe, it, expect, vi } from "vitest";
import { MuseveVoiceChannel } from "../../src/channel.js";
import { createBindingStore } from "../../src/binding-store.js";
import { createEvent } from "../../src/protocol.js";

function makeStore() {
  const data: Record<string, unknown> = {
    "channels.museve_voice.token": "t",
    "channels.museve_voice.instanceId": "oc_test",
    "channels.museve_voice.boundAt": "2026-05-15T00:00:00Z",
    "channels.museve_voice.boundUserId": "u_1",
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

describe("MuseveVoiceChannel + control events", () => {
  it("on binding_revoked: clears local binding and emits unbound status", async () => {
    const { store, data } = makeStore();
    const statusUpdates: string[] = [];

    const channel = new MuseveVoiceChannel(
      { token: "t", apiBaseUrl: "https://api.example.com/api/v1/agent-channel" } as any,
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

    expect(data["channels.museve_voice.token"]).toBe("");
    expect(statusUpdates).toContain("unbound");

    await channel.stop();
  });
});
