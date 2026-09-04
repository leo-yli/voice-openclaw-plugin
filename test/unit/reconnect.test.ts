import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReconnectManager } from "../../src/reconnect.js";

describe("ReconnectManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with minDelay", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    expect(mgr.nextDelay()).toBe(1000);
  });

  it("increases delay exponentially", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    expect(mgr.nextDelay()).toBe(1000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(2000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(5000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(15000);
    mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(30000);
  });

  it("caps at maxDelay", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    for (let i = 0; i < 20; i++) mgr.recordAttempt();
    expect(mgr.nextDelay()).toBe(30000);
  });

  it("resets after successful connection", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    mgr.recordAttempt();
    mgr.recordAttempt();
    mgr.reset();
    expect(mgr.nextDelay()).toBe(1000);
  });

  it("tracks last event id for resume", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    mgr.recordEventId("evt_100");
    mgr.recordEventId("evt_200");
    expect(mgr.lastEventId).toBe("evt_200");
  });

  it("schedules reconnect callback", async () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    const fn = vi.fn();
    mgr.schedule(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("exposes whether a reconnect is already scheduled", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    expect(mgr.hasScheduledReconnect).toBe(false);
    mgr.schedule(() => {});
    expect(mgr.hasScheduledReconnect).toBe(true);
    mgr.cancel();
    expect(mgr.hasScheduledReconnect).toBe(false);
  });

  it("cancel prevents scheduled callback", () => {
    const mgr = new ReconnectManager({ minDelayMs: 1000, maxDelayMs: 30000, resume: true });
    const fn = vi.fn();
    mgr.schedule(fn);
    mgr.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
