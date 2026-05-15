import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULT_CONFIG } from "../../src/config.js";

describe("resolveConfig", () => {
  it("includes new binding fields with defaults", () => {
    const cfg = resolveConfig({ token: "t" });
    expect(cfg.apiBaseUrl).toBe("https://channel.xalgo.ai");
    expect(cfg.instanceId).toBe("");
    expect(cfg.boundAt).toBe("");
    expect(cfg.boundUserId).toBe("");
  });

  it("preserves user-provided binding fields", () => {
    const cfg = resolveConfig({
      token: "t",
      instanceId: "oc_uuid",
      boundUserId: "user_1",
      apiBaseUrl: "https://custom.example.com",
    });
    expect(cfg.instanceId).toBe("oc_uuid");
    expect(cfg.boundUserId).toBe("user_1");
    expect(cfg.apiBaseUrl).toBe("https://custom.example.com");
  });
});
