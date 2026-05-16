import type { OpenClawApi } from "openclaw";
import { createInboundAdapter, outbound } from "./src/channel.js";

/**
 * OpenClaw plugin entry.
 *
 * The default export MUST be a plugin object (not a function) following the
 * shape `{ id, name, description, configSchema, register }`. This is the
 * canonical contract used by OpenClaw — see e.g. WecomTeam/wecom-openclaw-plugin
 * (the official 企业微信 plugin from Tencent).
 *
 * If we export a bare function instead, OpenClaw fails to find the `register`
 * method on the plugin object and logs:
 *   "plugin register returned a promise; async registration is ignored"
 * and the channel never registers (Shape: non-capability).
 */
const plugin = {
  id: "xalgo_voice",
  name: "Xalgo Voice",
  description:
    "Voice channel plugin that connects Xalgo glasses and Pupa voice cloud to OpenClaw agents.",
  configSchema: {
    type: "object" as const,
    additionalProperties: true,
  },
  register(api: OpenClawApi): void {
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
  },
};

export default plugin;
