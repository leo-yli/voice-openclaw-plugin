import { describe, expect, it, vi } from "vitest";
import { museveVoiceSetupWizard } from "../../src/onboarding.js";

function makeCfg(channel: Record<string, unknown>) {
  return {
    channels: {
      museve_voice: channel,
    },
  };
}

function makeAccountCfg(account: Record<string, unknown>) {
  return {
    channelAccounts: {
      museve_voice: account,
    },
  };
}

describe("museveVoiceSetupWizard configured state", () => {
  it("treats a complete enabled binding as configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(true);
    expect(museveVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(true);
    expect(museveVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(false);
  });

  it("treats a disabled binding as not configured", () => {
    const cfg = makeCfg({
      enabled: false,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
  });

  it("treats partial binding data as not configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
    expect(museveVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(false);
    expect(museveVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(true);
  });

  it("credential inspect reports configured only for complete binding", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    const inspected = museveVoiceSetupWizard.credentials[0].inspect({ cfg });

    expect(inspected).toEqual({
      accountConfigured: true,
      hasConfiguredValue: true,
      resolvedValue: "xvc_live_abc",
    });
  });

  it("status lines mention missing required fields for partial binding", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
    });

    const lines = museveVoiceSetupWizard.status.resolveStatusLines({
      cfg,
      configured: false,
    });

    expect(lines.join("\n")).toContain("缺少");
    expect(lines.join("\n")).toContain("boundAt");
    expect(lines.join("\n")).toContain("boundUserId");
    expect(lines.join("\n")).toContain("apiBaseUrl");
  });

  it("treats OpenClaw channel account binding as configured", () => {
    const cfg = makeAccountCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(true);
    expect(museveVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(true);
  });

  it("accepts app-generated binding codes containing U", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            channel_token: "xvc_live_xyz",
            user_id: "u_1",
            user_display_name: "杨立",
            ws_url: "wss://example.com/ws",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const cfg = makeCfg({ _pendingCode: "6UM73YKK" });

    await expect(museveVoiceSetupWizard.finalize({ cfg })).resolves.toBeDefined();
    expect(cfg.channels.museve_voice.token).toBe("xvc_live_xyz");
    vi.unstubAllGlobals();
  });

  it("writes pending code to channel config only", () => {
    const cfg = makeCfg({});

    museveVoiceSetupWizard.credentials[0].applySet({ cfg, resolvedValue: "abcd3456" });

    expect(cfg.channels.museve_voice._pendingCode).toBe("ABCD3456");
    expect(cfg.channels.museve_voice.accountId).toBeUndefined();
    expect((cfg as any).channelAccounts).toBeUndefined();
  });
});
