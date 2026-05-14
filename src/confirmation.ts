import { createLogger } from "./logger.js";
import type { ConfirmationRequestPayload, ConfirmationResponsePayload } from "./protocol.js";

const log = createLogger("confirmation");

interface PendingConfirmation {
  request: ConfirmationRequestPayload;
  timer: ReturnType<typeof setTimeout>;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class ConfirmationManager {
  private pending = new Map<string, PendingConfirmation>();
  private resolveCallback: ((response: ConfirmationResponsePayload) => void) | null = null;

  onResolve(callback: (response: ConfirmationResponsePayload) => void): void {
    this.resolveCallback = callback;
  }

  validateRequest(
    request: ConfirmationRequestPayload,
    policy: { allowPureVoiceR3: boolean }
  ): ValidationResult {
    if (request.risk_level === "R3" && !policy.allowPureVoiceR3) {
      const hasPhoneCard = request.confirm_methods.includes("phone_card");
      if (!hasPhoneCard) {
        return {
          valid: false,
          reason: "R3 operations require phone_card confirmation, pure voice not allowed",
        };
      }
    }
    return { valid: true };
  }

  addPending(request: ConfirmationRequestPayload): void {
    const timeoutMs = Math.max(0, request.expires_at - Date.now());

    const timer = setTimeout(() => {
      this.handleTimeout(request.confirmation_id);
    }, timeoutMs);

    this.pending.set(request.confirmation_id, { request, timer });
    log.info(`Pending confirmation added: ${request.confirmation_id} (expires in ${timeoutMs}ms)`);
  }

  resolve(response: ConfirmationResponsePayload): void {
    const entry = this.pending.get(response.confirmation_id);
    if (!entry) {
      log.warn(`No pending confirmation for ${response.confirmation_id}`);
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(response.confirmation_id);
    log.info(`Confirmation resolved: ${response.confirmation_id} → ${response.result}`);
    this.resolveCallback?.(response);
  }

  hasPending(confirmationId: string): boolean {
    return this.pending.has(confirmationId);
  }

  getPending(confirmationId: string): ConfirmationRequestPayload | undefined {
    return this.pending.get(confirmationId)?.request;
  }

  cleanup(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    log.info("All pending confirmations cleared");
  }

  private handleTimeout(confirmationId: string): void {
    const entry = this.pending.get(confirmationId);
    if (!entry) return;

    this.pending.delete(confirmationId);
    log.info(`Confirmation timed out: ${confirmationId}`);

    const timeoutResponse: ConfirmationResponsePayload = {
      confirmation_id: confirmationId,
      chat_id: entry.request.chat_id,
      result: "timeout",
      text: "",
      method: entry.request.confirm_methods[0],
    };

    this.resolveCallback?.(timeoutResponse);
  }
}
