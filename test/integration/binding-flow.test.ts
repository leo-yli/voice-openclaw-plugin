import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockXalgoServer } from "./mock-server.js";
import { XalgoVoiceChannel } from "../../src/channel.js";
import { createBindingStore } from "../../src/binding-store.js";

describe("Integration: binding lifecycle", () => {
  let mock: MockXalgoServer;
  let port: number;

  beforeEach(async () => {
    mock = new MockXalgoServer({ heartbeatIntervalMs: 5000 });
    port = await mock.start();
  });

  afterEach(async () => {
    await mock.stop();
  });

  it("happy path: connect with stored binding → exchange messages → server revokes → channel emits unbound status", async () => {
    const memoryConfig: Record<string, unknown> = {
      "channels.xalgoVoice.token": "test_token",
      "channels.xalgoVoice.instanceId": "oc_test_inst",
      "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
      "channels.xalgoVoice.boundUserId": "u_1",
      "channels.xalgoVoice.boundUserName": "杨立",
    };
    const store = createBindingStore({
      read: async (k) => memoryConfig[k],
      write: async (k, v) => {
        memoryConfig[k] = v;
      },
    });

    const statusUpdates: string[] = [];
    const messages: unknown[] = [];

    const channel = new XalgoVoiceChannel(
      {
        token: "test_token",
        serverUrl: `ws://localhost:${port}`,
        apiBaseUrl: "https://api.example.com",
      } as any,
      store
    );

    await channel.start({
      handleMessage: (msg) => messages.push(msg),
      handleStatus: (s) => statusUpdates.push(s.status),
    });

    // 等待 mock-server 回应 connected
    await new Promise((r) => setTimeout(r, 300));

    // 发一条 inbound message
    mock.sendInboundMessage("hello");
    await new Promise((r) => setTimeout(r, 200));
    expect(messages.length).toBeGreaterThan(0);

    // 服务端推 binding_revoked
    mock.pushBindingRevoked("b_1", "user_unbound");
    await new Promise((r) => setTimeout(r, 300));

    // 验证本地清空 + 状态切到 unbound
    expect(memoryConfig["channels.xalgoVoice.token"]).toBe("");
    expect(memoryConfig["channels.xalgoVoice.instanceId"]).toBe("");
    expect(statusUpdates).toContain("unbound");

    await channel.stop();
  }, 10000);

  it("server pushes token_rotated_notify → channel attempts rotate via REST", async () => {
    const { vi } = await import("vitest");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ channel_token: "new_token_after_rotate" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      // 使用与 mock server 默认匹配的 token（"test_token"），
      // 确保 WebSocket 认证成功，之后再收 token_rotated_notify
      const memoryConfig: Record<string, unknown> = {
        "channels.xalgoVoice.token": "test_token",
        "channels.xalgoVoice.instanceId": "oc_test_inst",
        "channels.xalgoVoice.boundAt": "2026-05-15T00:00:00Z",
        "channels.xalgoVoice.boundUserId": "u_1",
      };
      const store = createBindingStore({
        read: async (k) => memoryConfig[k],
        write: async (k, v) => {
          memoryConfig[k] = v;
        },
      });

      const channel = new XalgoVoiceChannel(
        {
          token: "test_token",
          serverUrl: `ws://localhost:${port}`,
          apiBaseUrl: "https://api.example.com",
        } as any,
        store
      );

      await channel.start({ handleMessage: () => {}, handleStatus: () => {} });
      await new Promise((r) => setTimeout(r, 300));

      mock.pushTokenRotatedNotify("b_1");
      await new Promise((r) => setTimeout(r, 300));

      expect(memoryConfig["channels.xalgoVoice.token"]).toBe("new_token_after_rotate");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/v1/openclaw/bindings/rotate");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer test_token");

      await channel.stop();
    } finally {
      globalThis.fetch = original;
    }
  }, 10000);
});
