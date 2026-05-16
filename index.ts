import type { OpenClawApi } from "openclaw";
import { createInboundAdapter, outbound } from "./src/channel.js";

/**
 * OpenClaw plugin entry. Must be SYNCHRONOUS — returning a Promise causes
 * OpenClaw to log "plugin register returned a promise; async registration
 * is ignored" and skip the channel registration entirely.
 *
 * Exposed as both a named export (`register`) and a default export to maximize
 * compatibility with how OpenClaw resolves the entry function.
 */
export function register(api: OpenClawApi): void {
  api.registerChannel({
    plugin: {
      id: "xalgo_voice",
      meta: {
        id: "xalgo_voice",
        label: "Xalgo Voice",
        selectionLabel: "Xalgo Voice (语音)",
        docsPath: "/channels/xalgo-voice",
        blurb: "Talk to your OpenClaw agents through Xalgo voice devices.",
      },
      capabilities: {
        chatTypes: ["direct"],
        media: { images: false, files: false },
        reactions: false,
        threads: false,
        mentions: false,
        replyContext: true,
      },
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: (cfg: any, accountId?: string) =>
          cfg.channels?.xalgo_voice ?? { accountId: accountId ?? "default" },
      },
      outbound,
      inbound: createInboundAdapter(),
    },
  });
}

// Provide multiple export shapes so OpenClaw can find the entry under whatever
// name it looks for (register / setup / activate / default).
export const setup = register;
export const activate = register;
export default register;
