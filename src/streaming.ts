import { createLogger } from "./logger.js";
import { formatOutboundDelta } from "./outbound.js";
import type { XvcEvent, OutboundDeltaPayload } from "./protocol.js";

const log = createLogger("streaming");

export interface StreamSession {
  messageId: string;
  sessionId?: string;
  agentBindingId?: string;
  chatId: string;
  spanId: string;
  deltaSeq: number;
  totalText: string;
}

export interface StreamCancelSelector {
  messageId?: string;
  sessionId?: string;
  agentBindingId?: string;
  chatId?: string;
}

export class StreamingManager {
  private sessions = new Map<string, StreamSession>();

  startStream(
    messageId: string,
    chatId: string,
    options: { sessionId?: string; agentBindingId?: string } = {},
  ): StreamSession {
    const spanId = `span_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const session: StreamSession = {
      messageId,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.agentBindingId ? { agentBindingId: options.agentBindingId } : {}),
      chatId,
      spanId,
      deltaSeq: 0,
      totalText: "",
    };
    this.sessions.set(messageId, session);
    log.debug(`Stream started: ${messageId}`);
    return session;
  }

  pushDelta(messageId: string, textDelta: string): XvcEvent<OutboundDeltaPayload> | null {
    const session = this.sessions.get(messageId);
    if (!session) {
      log.warn(`No stream session for ${messageId}`);
      return null;
    }

    session.deltaSeq++;
    session.totalText += textDelta;

    return formatOutboundDelta({
      messageId: session.messageId,
      sessionId: session.sessionId,
      agentBindingId: session.agentBindingId,
      chatId: session.chatId,
      deltaSeq: session.deltaSeq,
      textDelta,
      spanId: session.spanId,
      isFinal: false,
    });
  }

  endStream(messageId: string): XvcEvent<OutboundDeltaPayload> | null {
    const session = this.sessions.get(messageId);
    if (!session) {
      log.warn(`No stream session to end: ${messageId}`);
      return null;
    }

    session.deltaSeq++;
    const finalEvent = formatOutboundDelta({
      messageId: session.messageId,
      sessionId: session.sessionId,
      agentBindingId: session.agentBindingId,
      chatId: session.chatId,
      deltaSeq: session.deltaSeq,
      textDelta: "",
      spanId: session.spanId,
      isFinal: true,
    });

    this.sessions.delete(messageId);
    log.debug(`Stream ended: ${messageId}, total length=${session.totalText.length}`);
    return finalEvent;
  }

  cancelStream(messageId: string): void {
    if (this.sessions.has(messageId)) {
      this.sessions.delete(messageId);
      log.debug(`Stream cancelled: ${messageId}`);
    }
  }

  cancelStreams(selector: StreamCancelSelector = {}): StreamSession[] {
    const cancelled: StreamSession[] = [];

    for (const session of Array.from(this.sessions.values())) {
      const matched =
        (selector.messageId && session.messageId === selector.messageId) ||
        (selector.sessionId && session.sessionId === selector.sessionId) ||
        (selector.agentBindingId && session.agentBindingId === selector.agentBindingId) ||
        (selector.chatId && session.chatId === selector.chatId) ||
        (!selector.messageId && !selector.sessionId && !selector.agentBindingId && !selector.chatId);

      if (!matched) continue;
      this.sessions.delete(session.messageId);
      cancelled.push(session);
      log.debug(`Stream cancelled: ${session.messageId}`);
    }

    return cancelled;
  }

  getSession(messageId: string): StreamSession | undefined {
    return this.sessions.get(messageId);
  }

  hasActiveStream(messageId: string): boolean {
    return this.sessions.has(messageId);
  }
}
