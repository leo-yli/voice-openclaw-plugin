import { describe, it, expect } from "vitest";
import { ExchangeError } from "../../src/rest-client.js";

describe("ExchangeError", () => {
  it("carries type and optional retryAfterSec", () => {
    const e = new ExchangeError("code_expired");
    expect(e.type).toBe("code_expired");
    expect(e.retryAfterSec).toBeUndefined();
    expect(e instanceof Error).toBe(true);
    expect(e.message).toBe("code_expired");
  });

  it("carries retryAfterSec for rate_limited", () => {
    const e = new ExchangeError("rate_limited", 60);
    expect(e.type).toBe("rate_limited");
    expect(e.retryAfterSec).toBe(60);
  });
});
