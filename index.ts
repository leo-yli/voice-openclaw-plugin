import type { OpenClawApi } from "openclaw";
import { createInboundAdapter, outbound } from "./src/channel.js";

export default function registerXalgoVoicePlugin(api: OpenClawApi) {
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
          cfg.channels?.xalgoVoice ?? { accountId: accountId ?? "default" },
      },
      outbound,
      inbound: createInboundAdapter(),
    },
  });
}

export { createInboundAdapter, outbound, XalgoVoiceChannel } from "./src/channel.js";
