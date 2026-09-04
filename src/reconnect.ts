import type { ReconnectConfig } from "./config.js";

const BACKOFF_STEPS = [1000, 2000, 5000, 15000, 30000];

export class ReconnectManager {
  private config: ReconnectConfig;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _lastEventId: string | null = null;
  private _connectionId: string | null = null;

  constructor(config: ReconnectConfig) {
    this.config = config;
  }

  get lastEventId(): string | null {
    return this._lastEventId;
  }

  get connectionId(): string | null {
    return this._connectionId;
  }

  get hasScheduledReconnect(): boolean {
    return this.timer !== null;
  }

  get shouldResume(): boolean {
    return this.config.resume && this._connectionId !== null && this._lastEventId !== null;
  }

  nextDelay(): number {
    const step = Math.min(this.attempt, BACKOFF_STEPS.length - 1);
    const delay = BACKOFF_STEPS[step];
    return Math.min(delay, this.config.maxDelayMs);
  }

  recordAttempt(): void {
    this.attempt++;
  }

  recordEventId(eventId: string): void {
    this._lastEventId = eventId;
  }

  recordConnectionId(connectionId: string): void {
    this._connectionId = connectionId;
  }

  reset(): void {
    this.attempt = 0;
    this.cancel();
  }

  schedule(fn: () => void): void {
    this.cancel();
    const delay = this.nextDelay();
    this.timer = setTimeout(fn, delay);
    this.recordAttempt();
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  clearSession(): void {
    this._lastEventId = null;
    this._connectionId = null;
  }
}
