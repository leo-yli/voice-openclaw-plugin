import { describe, expect, it, vi } from "vitest";
import plugin from "../../index.js";
import { resolveXalgoAccount } from "../../src/account-config.js";
import { createGatewayAdapter, createInboundAdapter } from "../../src/channel.js";

function makeCompleteConfig() {
  return {
    channels: {
      xalgo_voice: {
        enabled: true,
        token: "xvc_live_abc",
        instanceId: "oc_123",
        boundAt: "2026-05-19T03:39:43.192Z",
        boundUserId: "default-user",
        serverUrl: "ws://127.0.0.1:1",
        apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
        reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
      },
    },
  };
}

function makeCompleteAccountConfig() {
  return {
    channelAccounts: {
      xalgo_voice: {
        enabled: true,
        token: "xvc_live_abc",
        instanceId: "oc_123",
        boundAt: "2026-05-19T03:39:43.192Z",
        boundUserId: "default-user",
        serverUrl: "ws://127.0.0.1:1",
        apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
        reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
      },
    },
  };
}

function makeReadConfig(channel: Record<string, unknown>) {
  return async (key: string) => {
    const field = key.split(".").pop()!;
    return channel[field];
  };
}

describe("xalgo account config resolution", () => {
  it("treats the direct channel config object as the account", () => {
    const account = resolveXalgoAccount({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "ws://127.0.0.1:1",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(account).toMatchObject({
      accountId: "default",
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
    });
  });
});

describe("OpenClaw channel config hooks", () => {
  it("reports a complete channel binding as configured", () => {
    const config = makeCompleteConfig();
    let channelPlugin: any;

    plugin.register({
      registerChannel: vi.fn(({ plugin }) => {
        channelPlugin = plugin;
      }),
    } as any);

    const account = channelPlugin.config.resolveAccount(config, "default");

    expect(channelPlugin.config.isConfigured(account, config)).toBe(true);
  });

  it("registers a gateway account adapter so OpenClaw can run the channel", () => {
    let channelPlugin: any;

    plugin.register({
      registerChannel: vi.fn(({ plugin }) => {
        channelPlugin = plugin;
      }),
    } as any);

    expect(channelPlugin.gateway?.startAccount).toEqual(expect.any(Function));
  });
});

describe("createInboundAdapter startup", () => {
  it("does not emit a synthetic ready status after starting", async () => {
    const config = makeCompleteConfig();
    const statuses: string[] = [];
    const adapter = createInboundAdapter();

    await adapter.start({
      config,
      handleMessage: () => {},
      handleStatus: (status) => statuses.push(status.status),
      readConfig: makeReadConfig(config.channels.xalgo_voice),
      writeConfig: async () => {},
    });

    await adapter.stop();

    expect(statuses).toContain("connecting");
    expect(statuses).not.toContain("ready");
  });

  it("reports unbound and does not construct a websocket when required binding fields are missing", async () => {
    const config = {
      channels: {
        xalgo_voice: {
          enabled: true,
          token: "xvc_live_abc",
          instanceId: "oc_123",
          serverUrl: "ws://127.0.0.1:1",
          apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const statuses: string[] = [];
    const adapter = createInboundAdapter();

    await adapter.start({
      config,
      handleMessage: () => {},
      handleStatus: (status) => statuses.push(status.status),
      readConfig: makeReadConfig(config.channels.xalgo_voice),
      writeConfig: async () => {},
    });

    await adapter.stop();

    expect(statuses).toEqual(["unbound"]);
  });

  it("starts from OpenClaw channel account config", async () => {
    const config = makeCompleteAccountConfig();
    const statuses: string[] = [];
    const adapter = createInboundAdapter();

    await adapter.start({
      config,
      account: config.channelAccounts.xalgo_voice,
      handleMessage: () => {},
      handleStatus: (status) => statuses.push(status.status),
      readConfig: makeReadConfig(config.channelAccounts.xalgo_voice),
      writeConfig: async () => {},
    } as any);

    await adapter.stop();

    expect(statuses).toContain("connecting");
    expect(statuses).not.toContain("ready");
  });
});
