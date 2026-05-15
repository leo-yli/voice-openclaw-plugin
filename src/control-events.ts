import type { BindingStore } from "./binding-store.js";
import type { RestClient } from "./rest-client.js";
import type {
  BindingRevokedPayload,
  TokenRotatedNotifyPayload,
  BindingMetadataUpdatedPayload,
  ServerAnnouncementPayload,
} from "./protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("control-events");

const PROCESSED_EVENT_LRU_SIZE = 100;

export interface ControlEventDeps {
  bindingStore: BindingStore;
  restClient: RestClient;
  /** 失去绑定时通知上层（清 reconnect、上抛 status） */
  onBindingLost: (reason: BindingRevokedPayload["reason"]) => void;
  /** 停止重连定时器 */
  disableReconnect: () => void;
}

export interface ControlEventHandler {
  handleBindingRevoked: (payload: BindingRevokedPayload, eventId?: string) => Promise<void>;
  handleTokenRotatedNotify: (payload: TokenRotatedNotifyPayload, eventId?: string) => Promise<void>;
  handleMetadataUpdated: (payload: BindingMetadataUpdatedPayload, eventId?: string) => Promise<void>;
  handleAnnouncement: (payload: ServerAnnouncementPayload, eventId?: string) => Promise<void>;
}

export function createControlEventHandler(deps: ControlEventDeps): ControlEventHandler {
  const processedIds = new Set<string>();
  const processedOrder: string[] = [];

  function isAlreadyProcessed(eventId?: string): boolean {
    if (!eventId) return false;
    if (processedIds.has(eventId)) return true;
    processedIds.add(eventId);
    processedOrder.push(eventId);
    if (processedOrder.length > PROCESSED_EVENT_LRU_SIZE) {
      const oldest = processedOrder.shift();
      if (oldest) processedIds.delete(oldest);
    }
    return false;
  }

  return {
    async handleBindingRevoked(payload, eventId) {
      if (isAlreadyProcessed(eventId)) {
        log.debug(`Duplicate binding_revoked event_id=${eventId}, skipping`);
        return;
      }
      log.warn(`Binding revoked: ${payload.reason}`, payload);
      deps.disableReconnect();
      await deps.bindingStore.clear();
      deps.onBindingLost(payload.reason);
    },

    async handleTokenRotatedNotify(payload, eventId) {
      if (isAlreadyProcessed(eventId)) {
        log.debug(`Duplicate token_rotated_notify event_id=${eventId}, skipping`);
        return;
      }
      const binding = await deps.bindingStore.read();
      if (!binding) {
        log.warn("Received token_rotated_notify but no local binding, skipping");
        return;
      }
      try {
        const { channelToken: newToken } = await deps.restClient.rotate(
          binding.token,
          binding.instanceId
        );
        await deps.bindingStore.updateToken(newToken);
        log.info("Token rotated successfully");
      } catch (err) {
        log.error(`Token rotate failed: ${(err as Error).message}`);
      }
    },

    async handleMetadataUpdated(payload, eventId) {
      if (isAlreadyProcessed(eventId)) return;
      log.info("Binding metadata updated", payload.changes);
    },

    async handleAnnouncement(payload, eventId) {
      if (isAlreadyProcessed(eventId)) return;
      log.info(`[${payload.level.toUpperCase()}] ${payload.title}: ${payload.body}`);
    },
  };
}
