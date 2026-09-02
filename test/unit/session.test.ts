import { describe, it, expect } from "vitest";
import { buildSessionId, parseSessionId } from "../../src/session.js";

describe("session", () => {
  it("builds direct session ID", () => {
    expect(buildSessionId("direct", "u123", "museve_voice")).toBe("museve_voice:direct:u123");
  });

  it("builds room session ID", () => {
    expect(buildSessionId("room", "room_abc", "museve_voice")).toBe("museve_voice:room:room_abc");
  });

  it("parses direct session ID", () => {
    const parsed = parseSessionId("museve_voice:direct:u123");
    expect(parsed).toEqual({ type: "direct", id: "u123", prefix: "museve_voice" });
  });

  it("parses room session ID", () => {
    const parsed = parseSessionId("museve_voice:room:room_abc");
    expect(parsed).toEqual({ type: "room", id: "room_abc", prefix: "museve_voice" });
  });

  it("returns null for invalid session ID", () => {
    expect(parseSessionId("invalid")).toBeNull();
  });
});
