import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockXalgoServer } from "./mock-server.js";
import { createGatewayAdapter, XalgoVoiceChannel } from "../../src/channel.js";
import type { InboundMessage } from "../../src/inbound.js";
import { createBindingStore } from "../../src/binding-store.js";

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

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

    const memory1: Record<string, unknown> = {
      "channels.xalgo_voice.token": "valid_token",
      "channels.xalgo_voice.instanceId": "oc_test_instance",
      "channels.xalgo_voice.boundAt": "2026-05-15T00:00:00Z",
      "channels.xalgo_voice.boundUserId": "u_test",
    };
    const store1 = createBindingStore({
      read: async (k) => memory1[k],
      write: async (k, v) => { memory1[k] = v; },
    });

    const channel = new XalgoVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
    }, store1);

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
    const memory2: Record<string, unknown> = {
      "channels.xalgo_voice.token": "valid_token",
      "channels.xalgo_voice.instanceId": "oc_test_instance",
      "channels.xalgo_voice.boundAt": "2026-05-15T00:00:00Z",
      "channels.xalgo_voice.boundUserId": "u_test",
    };
    const store2 = createBindingStore({
      read: async (k) => memory2[k],
      write: async (k, v) => { memory2[k] = v; },
    });

    const channel = new XalgoVoiceChannel({
      token: "valid_token",
      serverUrl: server.getUrl(),
      streaming: false,
    }, store2);

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

  it("sends gateway OpenClaw replies back to Xalgo", async () => {
    const config = {
      channels: {
        xalgo_voice: {
          enabled: true,
          token: "valid_token",
          instanceId: "oc_test_instance",
          boundAt: "2026-05-15T00:00:00Z",
          boundUserId: "u_test",
          serverUrl: server.getUrl(),
          apiBaseUrl: "https://asr-test.jlpay.com",
          streaming: false,
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const runtime = {
      channel: {
        session: {
          recordInboundSession: async () => {},
          resolveStorePath: () => "/tmp/openclaw-test-session",
        },
        turn: {
          runPrepared: async ({ runDispatch }: any) => {
            await runDispatch();
          },
        },
        reply: {
          finalizeInboundContext: (ctx: any) => ctx,
          createChannelMessageReplyPipeline: () => ({ onModelSelected: () => {} }),
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "你有三个待办" });
          },
        },
      },
    };
    const abort = new AbortController();
    const gateway = createGatewayAdapter();
    const run = gateway.startAccount({
      cfg: config,
      account: config.channels.xalgo_voice,
      accountId: "default",
      abortSignal: abort.signal,
      runtime,
      setStatus: () => {},
    });

    try {
      await new Promise((r) => setTimeout(r, 300));
      server.sendInboundMessage("今天有什么待办");
      await waitFor(() => server.getReceivedEvents().some((e) => e.type === "outbound_message"));

      const outbound = server.getReceivedEvents().find((e) => e.type === "outbound_message");
      expect(outbound).toBeDefined();
      expect((outbound!.payload as any).text).toBe("你有三个待办");
      expect((outbound!.payload as any).reply_to).toMatch(/^msg_/);
      expect((outbound!.payload as any).session_id).toBe("voice_session_test");
      expect((outbound!.payload as any).agent_binding_id).toBe("agent_binding_test");
      expect((outbound!.payload as any).risk_state).toBe("R0");
      expect((outbound!.payload as any).is_final).toBe(true);
      expect((outbound!.payload as any).chat_id).toBe("xalgo:user:u123");
    } finally {
      abort.abort();
      await run;
    }
  });

  it("routes PUPA voice.user_turn replies with session fields", async () => {
    const config = {
      channels: {
        xalgo_voice: {
          enabled: true,
          token: "valid_token",
          instanceId: "oc_test_instance",
          boundAt: "2026-05-15T00:00:00Z",
          boundUserId: "u_test",
          serverUrl: server.getUrl(),
          apiBaseUrl: "https://asr-test.jlpay.com",
          streaming: false,
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const runtime = {
      channel: {
        session: {
          recordInboundSession: async () => {},
          resolveStorePath: () => "/tmp/openclaw-test-session",
        },
        turn: {
          runPrepared: async ({ runDispatch }: any) => {
            await runDispatch();
          },
        },
        reply: {
          finalizeInboundContext: (ctx: any) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await dispatcherOptions.deliver({ text: "收到语音回合" });
          },
        },
      },
    };
    const abort = new AbortController();
    const gateway = createGatewayAdapter();
    const run = gateway.startAccount({
      cfg: config,
      account: config.channels.xalgo_voice,
      accountId: "default",
      abortSignal: abort.signal,
      runtime,
      setStatus: () => {},
    });

    try {
      await new Promise((r) => setTimeout(r, 300));
      server.sendVoiceUserTurn({ utterance_id: "utt_turn_001" });
      await waitFor(() => server.getReceivedEvents().some((e) => e.type === "outbound_message" && (e.payload as any).text === "收到语音回合"));

      const outbound = server.getReceivedEvents().find((e) => e.type === "outbound_message" && (e.payload as any).text === "收到语音回合");
      expect(outbound).toBeDefined();
      expect((outbound!.payload as any).session_id).toBe("voice_session_test");
      expect((outbound!.payload as any).agent_binding_id).toBe("agent_binding_test");
      expect((outbound!.payload as any).reply_to).toBe("utt_turn_001");
    } finally {
      abort.abort();
      await run;
    }
  });

  it("cancels active gateway runtime work on voice.cancel_request", async () => {
    const config = {
      channels: {
        xalgo_voice: {
          enabled: true,
          token: "valid_token",
          instanceId: "oc_test_instance",
          boundAt: "2026-05-15T00:00:00Z",
          boundUserId: "u_test",
          serverUrl: server.getUrl(),
          apiBaseUrl: "https://asr-test.jlpay.com",
          streaming: false,
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const cancelRun = vi.fn();
    let dispatchSignal: AbortSignal | undefined;
    const runtime = {
      channel: {
        session: {
          recordInboundSession: async () => {},
          resolveStorePath: () => "/tmp/openclaw-test-session",
        },
        turn: {
          cancelRun,
          runPrepared: async ({ runDispatch, abortSignal }: any) => {
            dispatchSignal = abortSignal;
            await runDispatch();
          },
        },
        reply: {
          finalizeInboundContext: (ctx: any) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }: any) => {
            await new Promise<void>((resolve) => {
              dispatcherOptions.abortSignal.addEventListener("abort", () => resolve(), { once: true });
            });
            await dispatcherOptions.deliver({ text: "这条旧任务结果不应该发出" });
          },
        },
      },
    };
    const abort = new AbortController();
    const gateway = createGatewayAdapter();
    const run = gateway.startAccount({
      cfg: config,
      account: config.channels.xalgo_voice,
      accountId: "default",
      abortSignal: abort.signal,
      runtime,
      setStatus: () => {},
    });

    try {
      await new Promise((r) => setTimeout(r, 300));
      server.sendInboundMessage("帮我做一个长任务");
      await waitFor(() => dispatchSignal !== undefined);

      server.sendVoiceCancelRequest({ utterance_id: "utt_cancel_001" });
      await waitFor(() => cancelRun.mock.calls.length > 0);
      await waitFor(() => server.getReceivedEvents().some((e) => e.type === "outbound_message" && (e.payload as any).text === "已取消"));

      expect(dispatchSignal!.aborted).toBe(true);
      expect(cancelRun).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: "voice_session_test",
        agentBindingId: "agent_binding_test",
        reason: "user_voice_cancel",
      }));
      expect(server.getReceivedEvents().some((e) => e.type === "outbound_message" && (e.payload as any).text === "这条旧任务结果不应该发出")).toBe(false);
    } finally {
      abort.abort();
      await run;
    }
  });

  it("acks voice.cancel_request with session fields even without active work", async () => {
    const config = {
      channels: {
        xalgo_voice: {
          enabled: true,
          token: "valid_token",
          instanceId: "oc_test_instance",
          boundAt: "2026-05-15T00:00:00Z",
          boundUserId: "u_test",
          serverUrl: server.getUrl(),
          apiBaseUrl: "https://asr-test.jlpay.com",
          streaming: false,
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const runtime = {
      channel: {
        session: {
          recordInboundSession: async () => {},
          resolveStorePath: () => "/tmp/openclaw-test-session",
        },
        turn: {
          runPrepared: async ({ runDispatch }: any) => {
            await runDispatch();
          },
        },
        reply: {
          finalizeInboundContext: (ctx: any) => ctx,
          dispatchReplyWithBufferedBlockDispatcher: async () => {},
        },
      },
    };
    const abort = new AbortController();
    const gateway = createGatewayAdapter();
    const run = gateway.startAccount({
      cfg: config,
      account: config.channels.xalgo_voice,
      accountId: "default",
      abortSignal: abort.signal,
      runtime,
      setStatus: () => {},
    });

    try {
      await new Promise((r) => setTimeout(r, 300));
      server.sendVoiceCancelRequest({ utterance_id: "utt_cancel_no_run" });
      await waitFor(() => server.getReceivedEvents().some((e) => e.type === "outbound_message" && (e.payload as any).text === "已取消"));

      const outbound = server.getReceivedEvents().find((e) => e.type === "outbound_message" && (e.payload as any).text === "已取消");
      expect(outbound).toBeDefined();
      expect((outbound!.payload as any).session_id).toBe("voice_session_test");
      expect((outbound!.payload as any).agent_binding_id).toBe("agent_binding_test");
      expect((outbound!.payload as any).reply_to).toBe("utt_cancel_no_run");
    } finally {
      abort.abort();
      await run;
    }
  });
});
