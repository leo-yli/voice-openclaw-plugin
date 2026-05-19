import { describe, expect, it } from "vitest";
import { xalgoVoiceSetupWizard } from "../../src/onboarding.js";

function makeCfg(channel: Record<string, unknown>) {
  return {
    channels: {
      xalgo_voice: channel,
    },
  };
}

describe("xalgoVoiceSetupWizard configured state", () => {
  it("treats a complete enabled binding as configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/openclaw/connect",
      apiBaseUrl: "https://asr-test.jlpay.com",
    });

    expect(xalgoVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(true);
    expect(xalgoVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(true);
    expect(xalgoVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(false);
  });

  it("treats a disabled binding as not configured", () => {
    const cfg = makeCfg({
      enabled: false,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/openclaw/connect",
      apiBaseUrl: "https://asr-test.jlpay.com",
    });

    expect(xalgoVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
  });

  it("treats partial binding data as not configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      serverUrl: "wss://asr-test.jlpay.com/openclaw/connect",
      apiBaseUrl: "https://asr-test.jlpay.com",
    });

    expect(xalgoVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
    expect(xalgoVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(false);
    expect(xalgoVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(true);
  });

  it("credential inspect reports configured only for complete binding", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/openclaw/connect",
      apiBaseUrl: "https://asr-test.jlpay.com",
    });

    const inspected = xalgoVoiceSetupWizard.credentials[0].inspect({ cfg });

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
      serverUrl: "wss://asr-test.jlpay.com/openclaw/connect",
    });

    const lines = xalgoVoiceSetupWizard.status.resolveStatusLines({
      cfg,
      configured: false,
    });

    expect(lines.join("\n")).toContain("缺少");
    expect(lines.join("\n")).toContain("boundAt");
    expect(lines.join("\n")).toContain("boundUserId");
    expect(lines.join("\n")).toContain("apiBaseUrl");
  });
});
