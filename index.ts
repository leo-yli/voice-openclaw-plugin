import type { OpenClawApi } from "openclaw";
import {
  hasCompleteMuseveBinding,
  resolveMuseveAccount,
} from "./src/account-config.js";
import {
  createGatewayAdapter,
  createInboundAdapter,
  outbound,
} from "./src/channel.js";
import {
  museveVoiceSetupWizard,
  museveVoiceSetupAdapter,
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
  id: "museve_voice",
  name: "Museve Voice",
  description:
    "通过 Museve 眼镜语音接入 OpenClaw Agent，使用 8 位绑定码完成账号绑定。",
  configSchema: {
    type: "object" as const,
    additionalProperties: true,
  },
  register(api: OpenClawApi): void {
    api.registerChannel({
      plugin: {
        id: "museve_voice",
        meta: {
          id: "museve_voice",
          label: "Museve Voice",
          selectionLabel: "Museve Voice（Museve 眼镜语音接入 OpenClaw）",
          docsPath: "/channels/museve-voice",
          blurb: "通过 Museve 眼镜语音控制 OpenClaw Agent，使用 8 位绑定码完成绑定。",
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
            resolveMuseveAccount(cfg, accountId),
          isEnabled: (account: any) => account?.enabled !== false,
          isConfigured: (account: any) => hasCompleteMuseveBinding(account),
        },
        outbound,
        inbound: createInboundAdapter(),
        gateway: createGatewayAdapter(),
        // ★ 关键：声明式 setup wizard，'openclaw channels add' 命令会用
        //   到这两个字段来 prompt 用户输入 8 位绑定码并完成 exchange。
        //   参考 wecom-openclaw-plugin 的同款实现方式。
        setupWizard: museveVoiceSetupWizard,
        setup: museveVoiceSetupAdapter,
      } as any,
    });

    // 检测是否已绑定，没绑定时打印醒目提示（每次 OpenClaw 启动都提醒一次）
    warnIfUnbound(api);
  },
};

/**
 * 探测 OpenClaw config 里是否已写入 channels.museve_voice.token。
 * 没写入说明 setup 流程没跑完，提示用户运行 museve-bind。
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
    token = resolveMuseveAccount(cfg).token as string | undefined;
  } catch {
    /* ignore */
  }

  if (token && token.length > 0) return;

  console.log("");
  console.log(
    "┌────────────────────────────────────────────────────────────────┐",
  );
  console.log(
    "│  [museve_voice] Channel registered but NOT bound yet.           │",
  );
  console.log(
    "│  Run the binding wizard to receive an 8-digit code from        │",
  );
  console.log(
    "│  Museve App and exchange it for a Channel Token:                │",
  );
  console.log(
    "│                                                                │",
  );
  console.log(
    "│    node ~/.openclaw/extensions/museve_voice/dist/bin/museve-bind.js │",
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
