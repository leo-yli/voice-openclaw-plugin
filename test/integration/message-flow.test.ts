import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockXalgoServer } from "./mock-server.js";
import { XalgoVoiceChannel } from "../../src/channel.js";
import type { InboundMessage } from "../../src/inbound.js";

describe("integration: message flow", () => {
  let server: MockXalgoServer;

  beforeEach(async () => {
    server = new MockXalgoServer({ token: "valid_token" });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("receives inbound message from Xalgo", async () => {
    const messages: InboundMessage[] = [];

    const channel = new XalgoVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
    });

    await channel.start({
      handleMessage: (msg) => messages.push(msg),
      handleStatus: () => {},
    });

    await new Promise((r) => setTimeout(r, 300));

    server.sendInboundMessage("今天有什么待办");

    await new Promise((r) => setTimeout(r, 200));

    expect(messages.length).toBe(1);
    expect(messages[0].text).toBe("今天有什么待办");
    expect(messages[0].conversationType).toBe("direct");

    await channel.stop();
  });

  it("sends outbound reply to Xalgo", async () => {
    const channel = new XalgoVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
      streaming: false,
    });

    await channel.start({
      handleMessage: () => {},
      handleStatus: () => {},
    });

    await new Promise((r) => setTimeout(r, 300));

    channel.sendReply("你有三个待办", "msg_001", "xalgo:user:u123");

    await new Promise((r) => setTimeout(r, 200));

    const events = server.getReceivedEvents();
    const outbound = events.find((e) => e.type === "outbound_message");
    expect(outbound).toBeDefined();
    expect((outbound!.payload as any).text).toBe("你有三个待办");

    await channel.stop();
  });
});
