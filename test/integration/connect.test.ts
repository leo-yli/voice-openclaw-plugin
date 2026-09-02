import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockMuseveServer } from "./mock-server.js";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";
import { createBindingStore } from "../../src/binding-store.js";

describe("integration: connect", () => {
  let server: MockMuseveServer;

  beforeEach(async () => {
    server = new MockMuseveServer({ token: "valid_token" });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("connects and authenticates successfully", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "valid_token", serverUrl: server.getUrl() });
    const memory: Record<string, unknown> = {
      "channels.museve_voice.token": "valid_token",
      "channels.museve_voice.instanceId": "oc_test_instance",
      "channels.museve_voice.boundAt": "2026-05-15T00:00:00Z",
      "channels.museve_voice.boundUserId": "u_test",
    };
    const store = createBindingStore({
      read: async (k) => memory[k],
      write: async (k, v) => { memory[k] = v; },
    });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    }, store);

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("connected");
    client.disconnect();
  });

  it("reports auth_failed for invalid token", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "wrong_token", serverUrl: server.getUrl() });
    const memory: Record<string, unknown> = {
      "channels.museve_voice.token": "wrong_token",
      "channels.museve_voice.instanceId": "oc_test_instance",
      "channels.museve_voice.boundAt": "2026-05-15T00:00:00Z",
      "channels.museve_voice.boundUserId": "u_test",
    };
    const store = createBindingStore({
      read: async (k) => memory[k],
      write: async (k, v) => { memory[k] = v; },
    });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    }, store);

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("auth_failed");
    client.disconnect();
  });
});
