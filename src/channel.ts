import type { XvcEvent, InboundMessagePayload, VoiceUserTurnPayload, ConfirmationResponsePayload, VoiceInterruptPayload, VoiceCancelRequestPayload, DeliveryAckPayload, BindingRevokedPayload, TokenRotatedNotifyPayload, BindingMetadataUpdatedPayload, ServerAnnouncementPayload } from "./protocol.js";
import {
  missingXalgoBindingFields,
  readNonEmptyString,
  resolveXalgoAccount,
} from "./account-config.js";
import { type XalgoVoiceConfig, resolveConfig } from "./config.js";
import { XvcClient, type ConnectionStatus } from "./client.js";
import { describeInboundPayloadShape, parseInboundMessage, type InboundMessage } from "./inbound.js";
import { formatOutboundMessage } from "./outbound.js";
import { StreamingManager } from "./streaming.js";
import { ConfirmationManager } from "./confirmation.js";
import { InterruptHandler, parseVoiceCancelRequest, type VoiceCancelRequest } from "./interrupt.js";
import { DeliveryTracker } from "./delivery-ack.js";
import { createLogger } from "./logger.js";
import type { BindingStore } from "./binding-store.js";
import { createBindingStore, type StoreAdapter } from "./binding-store.js";
import { createControlEventHandler, type ControlEventHandler } from "./control-events.js";
import { createRestClient, type RestClient } from "./rest-client.js";

interface GatewayStatusSink {
  (status: Record<string, unknown>): void;
}

interface ReplyRouteContext {
  sessionId?: string;
  agentBindingId?: string;
}

type GatewayReplySender = (text: string, replyTo: string, chatId: string, route?: ReplyRouteContext) => void;

interface GatewayActiveRun {
  sessionKey: string;
  message: InboundMessage;
  abortController: AbortController;
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
  handleTransportActivity?: () => void;
  handleEvent?: (event: XvcEvent) => void;
  handleInterrupt?: (event: XvcEvent<VoiceInterruptPayload>) => void;
  handleCancelRequest?: (request: VoiceCancelRequest, event: XvcEvent<VoiceCancelRequestPayload>) => void;
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
        onTransportActivity: () => this.callbacks?.handleTransportActivity?.(),
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

  sendReply(text: string, replyTo: string, chatId: string, route: ReplyRouteContext = {}): void {
    const messageId = `reply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    if (this.config.streaming) {
      log.info(`Sending outbound_delta reply: msg=${messageId} session=${route.sessionId ?? "(none)"} replyTo=${replyTo} chat=${chatId} textLength=${text.length}`);
      const session = this.streaming.startStream(messageId, chatId, route);
      const delta = this.streaming.pushDelta(messageId, text);
      if (delta) this.client.send(delta);
      const final = this.streaming.endStream(messageId);
      if (final) this.client.send(final);
    } else {
      const event = formatOutboundMessage({
        messageId,
        sessionId: route.sessionId,
        agentBindingId: route.agentBindingId,
        chatId,
        replyTo,
        text,
        replyMode: this.config.replyMode,
      });
      log.info(`Sending outbound_message reply: msg=${messageId} session=${route.sessionId ?? "(none)"} replyTo=${replyTo} chat=${chatId} textLength=${text.length}`);
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
      case "voice.user_turn":
        this.handleInbound(event as XvcEvent<InboundMessagePayload | VoiceUserTurnPayload>);
        break;
      case "confirmation_response":
        this.confirmation.resolve(event.payload as ConfirmationResponsePayload);
        break;
      case "voice_interrupt":
      case "voice.interrupt":
        this.handleVoiceInterrupt(event as XvcEvent<VoiceInterruptPayload>);
        break;
      case "voice.cancel_request":
        this.handleVoiceCancelRequest(event as XvcEvent<VoiceCancelRequestPayload>);
        break;
      case "delivery_ack":
        this.delivery.handleAck(event.payload as DeliveryAckPayload);
        break;
      default:
        break;
    }
  }

  private handleInbound(event: XvcEvent<InboundMessagePayload | VoiceUserTurnPayload>): void {
    const msg = parseInboundMessage(event);
    if (!msg) {
      log.warn(`Failed to parse inbound message, skipping: ${describeInboundPayloadShape(event)}`);
      return;
    }
    log.info(`Inbound message accepted: id=${msg.id} chat=${msg.conversationId} textLength=${msg.text.length}`);
    this.callbacks?.handleMessage(msg);
  }

  private handleVoiceInterrupt(event: XvcEvent<VoiceInterruptPayload>): void {
    this.callbacks?.handleEvent?.(event);
    this.callbacks?.handleInterrupt?.(event);
    const followUp = this.interrupt.handleInterrupt(event);
    if (followUp) {
      this.callbacks?.handleMessage(followUp);
    }
  }

  private handleVoiceCancelRequest(event: XvcEvent<VoiceCancelRequestPayload>): void {
    this.callbacks?.handleEvent?.(event);
    const request = parseVoiceCancelRequest(event);
    const cancelled = this.streaming.cancelStreams({
      sessionId: request.sessionId,
      agentBindingId: request.agentBindingId,
      chatId: request.chatId,
    });
    log.info(`Voice cancel_request received: session=${request.sessionId ?? "(none)"} agentBinding=${request.agentBindingId ?? "(none)"} cancelledStreams=${cancelled.length}`);
    this.callbacks?.handleCancelRequest?.(request, event);
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
    async start({ config, account, handleMessage, handleEvent, handleStatus, handleInterrupt, handleCancelRequest, handleTransportActivity, readConfig, writeConfig }: {
      config: any;
      account?: any;
      handleMessage: (msg: InboundMessage) => void;
      handleEvent?: (event: any) => void;
      handleStatus: (status: { status: string }) => void;
      handleInterrupt?: (event: any) => void;
      handleCancelRequest?: (request: VoiceCancelRequest, event: any) => void;
      handleTransportActivity?: () => void;
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
      await channel.start({ handleMessage, handleStatus, handleTransportActivity, handleEvent, handleInterrupt, handleCancelRequest });
    },

    async stop() {
      if (channel) {
        await channel.stop();
        channel = null;
      }
    },

    sendReply(text: string, replyTo: string, chatId: string, route: ReplyRouteContext = {}): void {
      if (!channel) {
        log.warn("Cannot send reply, channel not started");
        return;
      }
      channel.sendReply(text, replyTo, chatId, route);
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
      channelRuntime?: any;
      setStatus: GatewayStatusSink;
    }) {
      log.info(`Gateway startAccount requested: account=${ctx.accountId}`);
      const statusSink: GatewayStatusSink = (patch) =>
        ctx.setStatus({ accountId: ctx.accountId, ...patch });
      const adapter = createInboundAdapter();
      const activeRuns = new Map<string, GatewayActiveRun>();
      const activeRunsBySessionId = new Map<string, GatewayActiveRun>();
      const activeRunsByAgentBindingId = new Map<string, GatewayActiveRun>();
      const pendingMessages = new Map<string, InboundMessage>();
      const sessionKeyFor = (message: InboundMessage) => `${ctx.accountId}:${message.conversationId}`;
      const indexActiveRun = (run: GatewayActiveRun) => {
        activeRuns.set(run.sessionKey, run);
        if (run.message.sessionId) activeRunsBySessionId.set(run.message.sessionId, run);
        if (run.message.agentBindingId) activeRunsByAgentBindingId.set(run.message.agentBindingId, run);
      };
      const removeActiveRun = (run: GatewayActiveRun) => {
        if (activeRuns.get(run.sessionKey) === run) activeRuns.delete(run.sessionKey);
        if (run.message.sessionId && activeRunsBySessionId.get(run.message.sessionId) === run) {
          activeRunsBySessionId.delete(run.message.sessionId);
        }
        if (run.message.agentBindingId && activeRunsByAgentBindingId.get(run.message.agentBindingId) === run) {
          activeRunsByAgentBindingId.delete(run.message.agentBindingId);
        }
      };
      const abortActiveRun = (run: GatewayActiveRun, reason: string) => {
        if (!run.abortController.signal.aborted) run.abortController.abort(reason);
        pendingMessages.delete(run.sessionKey);
        removeActiveRun(run);
        log.info(`OpenClaw dispatch aborted: msg=${run.message.id} session=${run.sessionKey} reason=${reason}`);
      };
      const findActiveRun = (selector: { sessionId?: string; agentBindingId?: string; chatId?: string }): GatewayActiveRun | null => {
        if (selector.sessionId) {
          const bySession = activeRunsBySessionId.get(selector.sessionId);
          if (bySession) return bySession;
        }
        if (selector.agentBindingId) {
          const byBinding = activeRunsByAgentBindingId.get(selector.agentBindingId);
          if (byBinding) return byBinding;
        }
        if (selector.chatId) {
          const byChat = activeRuns.get(`${ctx.accountId}:${selector.chatId}`);
          if (byChat) return byChat;
        }
        return null;
      };
      const dispatchMessage = async (message: InboundMessage): Promise<void> => {
        const sessionKey = sessionKeyFor(message);
        if (activeRuns.has(sessionKey)) {
          pendingMessages.set(sessionKey, message);
          log.info(`OpenClaw dispatch already active, queued latest inbound: msg=${message.id} session=${sessionKey}`);
          return;
        }

        const abortController = new AbortController();
        const run: GatewayActiveRun = { sessionKey, message, abortController };
        indexActiveRun(run);
        try {
          await dispatchGatewayInboundMessage(ctx, message, (text, replyTo, chatId, route) => {
            if (abortController.signal.aborted) {
              log.info(`Drop reply from aborted OpenClaw dispatch: msg=${message.id}`);
              return;
            }
            adapter.sendReply(text, replyTo, chatId, route);
          }, { abortSignal: abortController.signal });
        } finally {
          removeActiveRun(run);
          const pending = pendingMessages.get(sessionKey);
          if (pending) {
            pendingMessages.delete(sessionKey);
            void dispatchMessage(pending);
          }
        }
      };
      const handleCancelRequest = (request: VoiceCancelRequest) => {
        statusSink({ lastEventAt: Date.now(), lastTransportActivityAt: Date.now() });
        const run = findActiveRun(request);
        if (run) {
          abortActiveRun(run, request.reason ?? "voice.cancel_request");
        }

        invokeGatewayRuntimeCancel(ctx, request, run).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.log?.error?.(`[${ctx.accountId}] runtime cancel failed: ${msg}`);
          statusSink({ lastError: msg });
        });

        const targetMessage = run?.message;
        const chatId = request.chatId ?? targetMessage?.conversationId ?? request.sessionId ?? request.agentBindingId;
        if (chatId) {
          adapter.sendReply("已取消", request.utteranceId ?? targetMessage?.id ?? request.eventId, chatId, {
            sessionId: request.sessionId ?? targetMessage?.sessionId,
            agentBindingId: request.agentBindingId ?? targetMessage?.agentBindingId,
          });
        }
      };
      const handleInterrupt = (event: XvcEvent<VoiceInterruptPayload>) => {
        const payload = event.payload;
        const run = findActiveRun({
          sessionId: payload.session_id ?? payload.duplex_session_id,
          agentBindingId: payload.agent_binding_id,
          chatId: payload.chat_id,
        });
        if (run) abortActiveRun(run, "voice.interrupt");
      };
      const stopOnAbort = async () => {
        pendingMessages.clear();
        for (const run of Array.from(activeRuns.values())) abortActiveRun(run, "gateway.abort");
        activeRuns.clear();
        activeRunsBySessionId.clear();
        activeRunsByAgentBindingId.clear();
        await adapter.stop();
        statusSink({ connected: false });
      };

      statusSink({ connected: false, lastTransportActivityAt: null });
      await adapter.start({
        config: ctx.cfg,
        account: ctx.account,
        handleMessage: (message) => {
          statusSink({ lastEventAt: Date.now(), lastTransportActivityAt: Date.now() });
          dispatchMessage(message).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.log?.error?.(`[${ctx.accountId}] inbound dispatch failed: ${msg}`);
            statusSink({ lastError: msg });
          });
        },
        handleStatus: (status) => {
          applyGatewayConnectionStatus(statusSink, status.status);
        },
        handleInterrupt,
        handleCancelRequest,
        handleTransportActivity: () => {
          statusSink({ lastTransportActivityAt: Date.now() });
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
  channelRuntime?: any;
}, message: InboundMessage, sendReply: GatewayReplySender, options: { abortSignal?: AbortSignal } = {}): Promise<void> {
  const runtime = ctx.channelRuntime ?? ctx.runtime;
  const channelRuntime = runtime?.channel ?? runtime;
  const reply = channelRuntime?.reply;
  const turn = channelRuntime?.turn;
  const session = channelRuntime?.session;
  const recordInboundSession = session?.recordInboundSession;
  const dispatchReply = reply?.dispatchReplyWithBufferedBlockDispatcher;
  const runPrepared = turn?.runPrepared;
  const resolveStorePath = session?.resolveStorePath;

  const missing = [
    !reply?.finalizeInboundContext ? "reply.finalizeInboundContext" : "",
    !dispatchReply ? "reply.dispatchReplyWithBufferedBlockDispatcher" : "",
    !runPrepared ? "turn.runPrepared" : "",
    !recordInboundSession ? "session.recordInboundSession" : "",
    !resolveStorePath ? "session.resolveStorePath" : "",
  ].filter(Boolean);
  if (missing.length > 0) {
    log.warn(`Cannot dispatch inbound to OpenClaw, missing runtime APIs: ${missing.join(",")}`);
    return;
  }

  const agentId = typeof ctx.account?.agentId === "string" && ctx.account.agentId.trim()
    ? ctx.account.agentId.trim()
    : "default";
  const storePath = resolveStorePath(ctx.cfg?.session?.store, { agentId });
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

  log.info(`Dispatching inbound to OpenClaw: msg=${message.id} agent=${agentId} session=${ctxPayload.SessionKey}`);
  await runPrepared({
    channel: "xalgo_voice",
    accountId: ctx.accountId,
    routeSessionKey: ctxPayload.SessionKey,
    storePath,
    ctxPayload,
    recordInboundSession,
    abortSignal: options.abortSignal,
    signal: options.abortSignal,
    runDispatch: async () => await dispatchReply({
      ctx: ctxPayload,
      cfg: ctx.cfg,
      abortSignal: options.abortSignal,
      signal: options.abortSignal,
      dispatcherOptions: {
        abortSignal: options.abortSignal,
        signal: options.abortSignal,
        onReplyStart: () => {
          log.info(`OpenClaw reply started: msg=${message.id}`);
        },
        deliver: async (payload: any) => {
          if (options.abortSignal?.aborted) {
            log.info(`Drop dispatcher delivery after cancel: msg=${message.id}`);
            return;
          }
          const text = payload && typeof payload === "object" && "text" in payload ? String(payload.text ?? "") : "";
          if (!text.trim()) return;
          log.info(`OpenClaw reply deliver: msg=${message.id} textLength=${text.length}`);
          sendReply(text, message.id, message.conversationId, {
            sessionId: message.sessionId,
            agentBindingId: message.agentBindingId,
          });
        },
        onError: (error: unknown) => {
          throw error instanceof Error ? error : new Error(String(error));
        },
      },
    }),
  });
}

async function invokeGatewayRuntimeCancel(ctx: {
  cfg: any;
  account: any;
  accountId: string;
  runtime?: any;
  channelRuntime?: any;
}, request: VoiceCancelRequest, run: GatewayActiveRun | null): Promise<void> {
  const runtime = ctx.channelRuntime ?? ctx.runtime;
  const channelRuntime = runtime?.channel ?? runtime;
  const turn = channelRuntime?.turn;
  const tasks = channelRuntime?.tasks ?? channelRuntime?.task;
  const payload = {
    channel: "xalgo_voice",
    accountId: ctx.accountId,
    sessionId: request.sessionId,
    agentBindingId: request.agentBindingId,
    utteranceId: request.utteranceId,
    messageId: run?.message.id,
    routeSessionKey: run?.sessionKey,
    reason: request.reason ?? "user_voice_cancel",
    text: request.text,
    event: request.raw,
    abortSignal: run?.abortController.signal,
    signal: run?.abortController.signal,
  };

  const candidates = [
    { owner: turn, fn: turn?.cancelRun },
    { owner: turn, fn: turn?.cancel },
    { owner: turn, fn: turn?.abortRun },
    { owner: tasks, fn: tasks?.cancel },
    { owner: tasks, fn: tasks?.cancelTask },
    { owner: channelRuntime, fn: channelRuntime?.cancelRun },
    { owner: channelRuntime, fn: channelRuntime?.cancelTask },
    { owner: channelRuntime, fn: channelRuntime?.cancel },
    { owner: runtime, fn: runtime?.cancelRun },
    { owner: runtime, fn: runtime?.cancelTask },
    { owner: runtime, fn: runtime?.cancel },
  ].filter((candidate): candidate is { owner: any; fn: (arg: typeof payload) => unknown } => typeof candidate.fn === "function");

  if (candidates.length === 0) {
    log.warn("Runtime has no cancel API for voice.cancel_request; relying on local abort/drop guards");
    return;
  }

  await Promise.resolve(candidates[0].fn.call(candidates[0].owner, payload));
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
