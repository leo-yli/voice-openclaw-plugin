import type { OpenClawApi } from "openclaw";
import {
  hasCompleteXalgoBinding,
  resolveXalgoAccount,
} from "./src/account-config.js";
import { createInboundAdapter, outbound } from "./src/channel.js";
import {
  xalgoVoiceSetupWizard,
  xalgoVoiceSetupAdapter,
} from "./src/onboarding.js";

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
            resolveXalgoAccount(cfg, accountId),
          isEnabled: (account: any) => account?.enabled !== false,
          isConfigured: (account: any) => hasCompleteXalgoBinding(account),
        },
        outbound,
        inbound: createInboundAdapter(),
        // ★ 关键：声明式 setup wizard，'openclaw channels add' 命令会用
        //   到这两个字段来 prompt 用户输入 8 位绑定码并完成 exchange。
        //   参考 wecom-openclaw-plugin 的同款实现方式。
        setupWizard: xalgoVoiceSetupWizard,
        setup: xalgoVoiceSetupAdapter,
      } as any,
    });

    // 检测是否已绑定，没绑定时打印醒目提示（每次 OpenClaw 启动都提醒一次）
    warnIfUnbound(api);
  },
};

/**
 * 探测 OpenClaw config 里是否已写入 channels.xalgo_voice.token。
 * 没写入说明 setup 流程没跑完，提示用户运行 xalgo-bind。
 *
 * 用 api.runtime?.getConfig 优先；如果不存在退化到读 ~/.openclaw/openclaw.json。
 */
function warnIfUnbound(api: OpenClawApi): void {
  let token: string | undefined;
  try {
    // OpenClawApi 形状不固定，best-effort 读取
    const runtime = (api as any).runtime;
    const cfg =
      typeof runtime?.getConfig === "function"
        ? runtime.getConfig()
        : (api as any).config ?? {};
    token = resolveXalgoAccount(cfg).token as string | undefined;
  } catch {
    /* ignore */
  }

  if (token && token.length > 0) return;

  console.log("");
  console.log(
    "┌────────────────────────────────────────────────────────────────┐",
  );
  console.log(
    "│  [xalgo_voice] Channel registered but NOT bound yet.           │",
  );
  console.log(
    "│  Run the binding wizard to receive an 8-digit code from        │",
  );
  console.log(
    "│  Xalgo App and exchange it for a Channel Token:                │",
  );
  console.log(
    "│                                                                │",
  );
  console.log(
    "│    node ~/.openclaw/extensions/xalgo_voice/dist/bin/xalgo-bind.js │",
  );
  console.log(
    "│                                                                │",
  );
  console.log(
    "│  Then restart OpenClaw to load the binding.                    │",
  );
  console.log(
    "└────────────────────────────────────────────────────────────────┘",
  );
  console.log("");
}

export default plugin;
