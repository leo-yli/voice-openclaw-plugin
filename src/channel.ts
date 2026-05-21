import type { XvcEvent, InboundMessagePayload, ConfirmationResponsePayload, VoiceInterruptPayload, DeliveryAckPayload, BindingRevokedPayload, TokenRotatedNotifyPayload, BindingMetadataUpdatedPayload, ServerAnnouncementPayload } from "./protocol.js";
import {
  missingXalgoBindingFields,
  readNonEmptyString,
  resolveXalgoAccount,
} from "./account-config.js";
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

interface GatewayStatusSink {
  (status: Record<string, unknown>): void;
}

const log = createLogger("channel");

function describeRuntimeConfig(config: Record<string, unknown>): string {
  const serverUrl = readNonEmptyString(config, "serverUrl") || "(missing)";
  const instanceId = readNonEmptyString(config, "instanceId");
  const token = readNonEmptyString(config, "token");
  const missing = missingXalgoBindingFields(config);
  return [
    `serverUrl=${serverUrl}`,
    `token=${token ? "set" : "missing"}`,
    `instanceId=${instanceId || "missing"}`,
    `missing=${missing.length ? missing.join(",") : "none"}`,
  ].join(" ");
}

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
    async start({ config, account, handleMessage, handleStatus, readConfig, writeConfig }: {
      config: any;
      account?: any;
      handleMessage: (msg: InboundMessage) => void;
      handleEvent?: (event: any) => void;
      handleStatus: (status: { status: string }) => void;
      readConfig?: (key: string) => Promise<unknown>;
      writeConfig?: (key: string, value: unknown) => Promise<void>;
    }) {
      const xalgoConfig = resolveXalgoAccount({ ...config, channelAccounts: config.channelAccounts }, account?.accountId);
      Object.assign(xalgoConfig, account ?? {});
      const adapter: StoreAdapter = {
        read: readConfig ?? (async (k) => xalgoConfig[k.split(".").pop()!]),
        write: writeConfig ?? (async () => {
          log.warn("writeConfig not provided, binding updates will not persist");
        }),
      };
      const store = createBindingStore(adapter);
      const binding = await store.read();
      if (!binding) {
        log.warn(`Channel start skipped: incomplete binding ${describeRuntimeConfig(xalgoConfig)}`);
        handleStatus({ status: "unbound" });
        return;
      }

      log.info(`Channel start requested: ${describeRuntimeConfig(xalgoConfig)}`);
      channel = new XalgoVoiceChannel(xalgoConfig as Partial<XalgoVoiceConfig> & { token: string }, store);
      await channel.start({ handleMessage, handleStatus });
    },

    async stop() {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },
  };
}

export function createGatewayAdapter() {
  return {
    async startAccount(ctx: {
      cfg: any;
      account: any;
      accountId: string;
      abortSignal: AbortSignal;
      log?: { info?: (message: string) => void; warn?: (message: string) => void; error?: (message: string) => void };
      runtime?: any;
      setStatus: GatewayStatusSink;
    }) {
      const statusSink: GatewayStatusSink = (patch) =>
        ctx.setStatus({ accountId: ctx.accountId, ...patch });
      const adapter = createInboundAdapter();
      const stopOnAbort = async () => {
        await adapter.stop();
        statusSink({ connected: false });
      };

      statusSink({ connected: false, lastTransportActivityAt: null });
      await adapter.start({
        config: ctx.cfg,
        account: ctx.account,
        handleMessage: (message) => {
          statusSink({ lastEventAt: Date.now(), lastTransportActivityAt: Date.now() });
          dispatchGatewayInboundMessage(ctx, message).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.log?.error?.(`[${ctx.accountId}] inbound dispatch failed: ${msg}`);
            statusSink({ lastError: msg });
          });
        },
        handleStatus: (status) => {
          applyGatewayConnectionStatus(statusSink, status.status);
        },
        writeConfig: async () => {
          ctx.log?.warn?.(`[${ctx.accountId}] writeConfig not provided by OpenClaw gateway runtime`);
        },
      });

      if (ctx.abortSignal.aborted) {
        await stopOnAbort();
        return;
      }

      ctx.abortSignal.addEventListener("abort", () => {
        stopOnAbort().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log?.error?.(`[${ctx.accountId}] channel stop failed: ${msg}`);
        });
      }, { once: true });

      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  };
}

function applyGatewayConnectionStatus(statusSink: GatewayStatusSink, status: string): void {
  const now = Date.now();
  switch (status) {
    case "connected":
      statusSink({ connected: true, lastConnectedAt: now, lastEventAt: now, lastTransportActivityAt: now, lastError: null });
      break;
    case "connecting":
      statusSink({ connected: false, lastTransportActivityAt: now });
      break;
    case "disconnected":
      statusSink({ connected: false });
      break;
    case "auth_failed":
    case "unbound":
      statusSink({ connected: false, lastError: status });
      break;
  }
}

async function dispatchGatewayInboundMessage(ctx: {
  cfg: any;
  account: any;
  accountId: string;
  runtime?: any;
}, message: InboundMessage): Promise<void> {
  const runtime = ctx.runtime;
  const reply = runtime?.channel?.reply;
  const turn = runtime?.channel?.turn;
  const session = runtime?.channel?.session;
  const recordInboundSession = session?.recordInboundSession;
  const dispatchReply = reply?.dispatchReplyWithBufferedBlockDispatcher;
  const createPipeline = reply?.createChannelMessageReplyPipeline ?? reply?.createChannelReplyPipeline;
  const runPrepared = turn?.runPrepared;
  const resolveStorePath = session?.resolveStorePath;

  if (!reply?.finalizeInboundContext || !dispatchReply || !createPipeline || !runPrepared || !recordInboundSession || !resolveStorePath) {
    return;
  }

  const storePath = resolveStorePath(ctx.cfg?.session?.store, { agentId: "default" });
  const ctxPayload = reply.finalizeInboundContext({
    Body: message.text,
    BodyForAgent: message.text,
    RawBody: message.text,
    CommandBody: message.text,
    From: message.sender.id,
    To: message.conversationId,
    SessionKey: `${ctx.accountId}:${message.conversationId}`,
    AccountId: ctx.accountId,
    ChatType: message.conversationType,
    WasMentioned: message.conversationType === "direct" ? undefined : true,
    ConversationLabel: message.conversationType === "direct" ? message.sender.name : message.conversationId,
    GroupChannel: message.conversationType === "group" ? message.conversationId : undefined,
    NativeChannelId: message.conversationId,
    SenderName: message.sender.name,
    SenderId: message.sender.id,
    Provider: "xalgo_voice",
    Surface: "xalgo_voice",
    MessageSid: message.id,
    MessageSidFull: message.id,
    ReplyToId: message.id,
    Timestamp: message.timestamp,
    OriginatingChannel: "xalgo_voice",
    OriginatingTo: message.conversationId,
    CommandAuthorized: true,
  });
  const { onModelSelected, ...replyPipeline } = createPipeline({
    cfg: ctx.cfg,
    agentId: "default",
    channel: "xalgo_voice",
    accountId: ctx.accountId,
  });

  await runPrepared({
    channel: "xalgo_voice",
    accountId: ctx.accountId,
    routeSessionKey: ctxPayload.SessionKey,
    storePath,
    ctxPayload,
    recordInboundSession,
    runDispatch: async () => await dispatchReply({
      ctx: ctxPayload,
      cfg: ctx.cfg,
      dispatcherOptions: {
        ...replyPipeline,
        deliver: async (payload: any) => {
          const text = payload && typeof payload === "object" && "text" in payload ? String(payload.text ?? "") : "";
          if (!text.trim()) return;
        },
        onError: (error: unknown) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
      },
      replyOptions: { onModelSelected },
    }),
  });
}

export const outbound = {
  deliveryMode: "direct" as const,

  listAccountIds: () => ["default"],

  resolveAccount: (config: any, accountId?: string) => {
    return resolveXalgoAccount(config, accountId);
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
