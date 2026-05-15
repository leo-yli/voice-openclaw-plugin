import type { XvcEvent, InboundMessagePayload, ConfirmationResponsePayload, VoiceInterruptPayload, DeliveryAckPayload, BindingRevokedPayload, TokenRotatedNotifyPayload, BindingMetadataUpdatedPayload, ServerAnnouncementPayload } from "./protocol.js";
import { type XalgoVoiceConfig, resolveConfig } from "./config.js";
import { XvcClient, type ConnectionStatus } from "./client.js";
import { parseInboundMessage, type InboundMessage } from "./inbound.js";
import { formatOutboundMessage } from "./outbound.js";
import { StreamingManager } from "./streaming.js";
import { ConfirmationManager } from "./confirmation.js";
import { InterruptHandler } from "./interrupt.js";
import { DeliveryTracker } from "./delivery-ack.js";
import { createLogger } from "./logger.js";
import type { BindingStore } from "./binding-store.js";
import { createBindingStore, type StoreAdapter } from "./binding-store.js";
import { createControlEventHandler, type ControlEventHandler } from "./control-events.js";
import { createRestClient, type RestClient } from "./rest-client.js";

const log = createLogger("channel");

export interface ChannelCallbacks {
  handleMessage: (msg: InboundMessage) => void;
  handleStatus: (status: { status: string }) => void;
}

export class XalgoVoiceChannel {
  private config: XalgoVoiceConfig;
  private client: XvcClient;
  private streaming: StreamingManager;
  private confirmation: ConfirmationManager;
  private interrupt: InterruptHandler;
  private delivery: DeliveryTracker;
  private callbacks: ChannelCallbacks | null = null;
  private bindingStore: BindingStore;
  private restClient: RestClient;
  private controlEvents: ControlEventHandler;

  constructor(
    rawConfig: Partial<XalgoVoiceConfig> & { token: string },
    bindingStore: BindingStore
  ) {
    this.config = resolveConfig(rawConfig);
    this.bindingStore = bindingStore;
    this.restClient = createRestClient(this.config.apiBaseUrl);
    this.streaming = new StreamingManager();
    this.confirmation = new ConfirmationManager();
    this.interrupt = new InterruptHandler();
    this.delivery = new DeliveryTracker();

    this.controlEvents = createControlEventHandler({
      bindingStore: this.bindingStore,
      restClient: this.restClient,
      onBindingLost: (reason) => {
        log.warn(`Binding lost: ${reason}`);
        this.callbacks?.handleStatus({ status: "unbound" });
      },
      disableReconnect: () => this.client.disableReconnect(),
    });

    this.client = new XvcClient(
      this.config,
      {
        onEvent: (event) => this.dispatchEvent(event),
        onStatusChange: (status) => this.handleStatusChange(status),
        onControlEvent: (event) => this.dispatchControlEvent(event),
      },
      bindingStore
    );

    this.interrupt.onCancelRun((messageId) => {
      this.streaming.cancelStream(messageId);
      log.info(`Cancelled stream for interrupted message: ${messageId}`);
    });

    this.confirmation.onResolve((response) => {
      log.info(`Confirmation ${response.confirmation_id} resolved: ${response.result}`);
    });
  }

  async start(callbacks: ChannelCallbacks): Promise<void> {
    this.callbacks = callbacks;
    await this.client.connect();
  }

  async stop(): Promise<void> {
    this.client.disconnect();
    this.confirmation.cleanup();
    this.callbacks = null;
  }

  sendReply(text: string, replyTo: string, chatId: string): void {
    const messageId = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    if (this.config.streaming) {
      const session = this.streaming.startStream(messageId, chatId);
      const delta = this.streaming.pushDelta(messageId, text);
      if (delta) this.client.send(delta);
      const final = this.streaming.endStream(messageId);
      if (final) this.client.send(final);
    } else {
      const event = formatOutboundMessage({
        messageId,
        chatId,
        replyTo,
        text,
        replyMode: this.config.replyMode,
      });
      this.client.send(event);
    }

    this.delivery.trackSent(messageId);
  }

  sendStreamDelta(messageId: string, chatId: string, textDelta: string): void {
    if (!this.streaming.hasActiveStream(messageId)) {
      this.streaming.startStream(messageId, chatId);
    }
    const delta = this.streaming.pushDelta(messageId, textDelta);
    if (delta) this.client.send(delta);
  }

  endStream(messageId: string): void {
    const final = this.streaming.endStream(messageId);
    if (final) this.client.send(final);
  }

  private dispatchEvent(event: XvcEvent): void {
    switch (event.type) {
      case "inbound_message":
        this.handleInbound(event as XvcEvent<InboundMessagePayload>);
        break;
      case "confirmation_response":
        this.confirmation.resolve(event.payload as ConfirmationResponsePayload);
        break;
      case "voice_interrupt":
        this.handleVoiceInterrupt(event as XvcEvent<VoiceInterruptPayload>);
        break;
      case "delivery_ack":
        this.delivery.handleAck(event.payload as DeliveryAckPayload);
        break;
      default:
        break;
    }
  }

  private handleInbound(event: XvcEvent<InboundMessagePayload>): void {
    const msg = parseInboundMessage(event);
    if (!msg) {
      log.warn("Failed to parse inbound message, skipping");
      return;
    }
    this.callbacks?.handleMessage(msg);
  }

  private handleVoiceInterrupt(event: XvcEvent<VoiceInterruptPayload>): void {
    const followUp = this.interrupt.handleInterrupt(event);
    if (followUp) {
      this.callbacks?.handleMessage(followUp);
    }
  }

  private handleStatusChange(status: ConnectionStatus): void {
    this.callbacks?.handleStatus({ status });
  }

  private dispatchControlEvent(event: XvcEvent): void {
    switch (event.type) {
      case "binding_revoked":
        this.controlEvents
          .handleBindingRevoked(event.payload as BindingRevokedPayload, event.event_id)
          .catch((err) => log.error("handleBindingRevoked failed", err));
        break;
      case "token_rotated_notify":
        this.controlEvents
          .handleTokenRotatedNotify(event.payload as TokenRotatedNotifyPayload, event.event_id)
          .catch((err) => log.error("handleTokenRotatedNotify failed", err));
        break;
      case "binding_metadata_updated":
        this.controlEvents
          .handleMetadataUpdated(event.payload as BindingMetadataUpdatedPayload, event.event_id)
          .catch((err) => log.error("handleMetadataUpdated failed", err));
        break;
      case "server_announcement":
        this.controlEvents
          .handleAnnouncement(event.payload as ServerAnnouncementPayload, event.event_id)
          .catch((err) => log.error("handleAnnouncement failed", err));
        break;
      default:
        log.warn(`Unknown control event type: ${event.type}`);
    }
  }
}

export function createInboundAdapter() {
  let channel: XalgoVoiceChannel | null = null;

  return {
    async start({ config, handleMessage, handleStatus, readConfig, writeConfig }: {
      config: any;
      account?: any;
      handleMessage: (msg: InboundMessage) => void;
      handleEvent?: (event: any) => void;
      handleStatus: (status: { status: string }) => void;
      readConfig?: (key: string) => Promise<unknown>;
      writeConfig?: (key: string, value: unknown) => Promise<void>;
    }) {
      const xalgoConfig = config.channels?.xalgoVoice ?? config;
      const adapter: StoreAdapter = {
        read: readConfig ?? (async (k) => xalgoConfig[k.split(".").pop()!]),
        write: writeConfig ?? (async () => {
          log.warn("writeConfig not provided, binding updates will not persist");
        }),
      };
      const store = createBindingStore(adapter);
      channel = new XalgoVoiceChannel(xalgoConfig, store);
      await channel.start({ handleMessage, handleStatus });
      handleStatus({ status: "ready" });
    },

    async stop() {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },
  };
}

export const outbound = {
  deliveryMode: "direct" as const,

  listAccountIds: () => ["default"],

  resolveAccount: (config: any, accountId?: string) => {
    return config.channels?.xalgoVoice ?? { accountId: accountId ?? "default" };
  },

  async sendText({ account, config, text, context }: {
    account: any;
    config: any;
    text: string;
    context: { conversationId: string; recipientId?: string; conversationType?: string };
  }) {
    return { ok: true, messageId: `msg_${Date.now()}` };
  },
};
