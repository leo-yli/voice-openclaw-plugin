import { describe, it, expect } from "vitest";
import { buildSessionId, parseSessionId } from "../../src/session.js";

describe("session", () => {
  it("builds direct session ID", () => {
    expect(buildSessionId("direct", "u123", "xalgo_voice")).toBe("xalgo_voice:direct:u123");
  });

  it("builds room session ID", () => {
    expect(buildSessionId("room", "room_abc", "xalgo_voice")).toBe("xalgo_voice:room:room_abc");
  });

  it("parses direct session ID", () => {
    const parsed = parseSessionId("xalgo_voice:direct:u123");
    expect(parsed).toEqual({ type: "direct", id: "u123", prefix: "xalgo_voice" });
  });

  it("parses room session ID", () => {
    const parsed = parseSessionId("xalgo_voice:room:room_abc");
    expect(parsed).toEqual({ type: "room", id: "room_abc", prefix: "xalgo_voice" });
  });

  it("returns null for invalid session ID", () => {
    expect(parseSessionId("invalid")).toBeNull();
  });
});
