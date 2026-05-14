import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockXalgoServer } from "./mock-server.js";
import { XvcClient } from "../../src/client.js";
import { resolveConfig } from "../../src/config.js";

describe("integration: connect", () => {
  let server: MockXalgoServer;

  beforeEach(async () => {
    server = new MockXalgoServer({ token: "valid_token" });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("connects and authenticates successfully", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "valid_token", serverUrl: server.getUrl() });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("connected");
    client.disconnect();
  });

  it("reports auth_failed for invalid token", async () => {
    const statusChanges: string[] = [];
    const config = resolveConfig({ token: "wrong_token", serverUrl: server.getUrl() });

    const client = new XvcClient(config, {
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 200));

    expect(statusChanges).toContain("auth_failed");
    client.disconnect();
  });
});
