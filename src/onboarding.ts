/**
 * Xalgo Voice setupWizard —— 声明式 channel setup wizard。
 *
 * OpenClaw 通过 channel plugin 对象上的 `setupWizard` / `setup` 字段识别并驱动
 * 引导配置流程（`openclaw channels add` 命令会用到）。
 *
 * 模板参考 wecom-openclaw-plugin 的 src/onboarding.ts。我们和 wecom 的差异：
 * wecom 用户直接输入最终凭据（botId + secret）；我们用户输入的是 8 位临时
 * 绑定码，需要异步 exchange 换长期 token。所以：
 *   - credentials[0].applySet 只把绑定码"暂存"到 _pendingCode
 *   - finalize 钩子里同步等 exchange 完成、写真 token，再清掉 _pendingCode
 */

import crypto from "node:crypto";
import os from "node:os";
import {
  hasCompleteXalgoBinding,
  missingXalgoBindingFields,
  readNonEmptyString,
  resolveXalgoAccount,
  setXalgoAccount,
} from "./account-config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { createRestClient, ExchangeError } from "./rest-client.js";

const PLUGIN_VERSION = "2026.5.16";
const CHANNEL_ID = "xalgo_voice";
const CODE_REGEX = /^[A-Z0-9]{8}$/i;

/**
 * ChannelSetupAdapter — OpenClaw 通用 setup 流程把 input 应用到 cfg 时用。
 * input.token 是用户输入的 8 位绑定码（OpenClaw 把绑定凭据通称为 token）。
 */
export const xalgoVoiceSetupAdapter: any = {
  applyAccountConfig: ({ cfg, input }: any) => {
    if (input?.token !== undefined) {
      setXalgoAccount(cfg, { _pendingCode: String(input.token).trim().toUpperCase() });
    }
    return cfg;
  },
};

/**
 * ChannelSetupWizard — 声明式 channel setup 引导配置。
 * 各回调由 OpenClaw 框架按生命周期顺序调用。
 */
export const xalgoVoiceSetupWizard: any = {
  channel: CHANNEL_ID,

  // ── 状态展示（onboarding 总览里的描述） ─────────────────────────────
  status: {
    configuredLabel: "已绑定 ✓",
    unconfiguredLabel: "需要 8 位绑定码",
    configuredHint: "已绑定到 Xalgo 账号",
    unconfiguredHint: "未绑定",
    resolveConfigured: ({ cfg }: any) => hasCompleteXalgoBinding(resolveXalgoAccount(cfg)),
    resolveStatusLines: ({ cfg, configured }: any) => {
      const account = resolveXalgoAccount(cfg);
      if (configured) {
        return [
          `Xalgo Voice: 已绑定到 ${readNonEmptyString(account, "boundUserName") || readNonEmptyString(account, "boundUserId") || "(未知)"}`,
        ];
      }

      const missing = missingXalgoBindingFields(account);
      return [
        missing.length > 0
          ? `Xalgo Voice: 未绑定或配置不完整（缺少 ${missing.join(", ")}）`
          : "Xalgo Voice: 未绑定（需要 8 位绑定码）",
      ];
    },
  },

  // ── 引导说明（首次进入向导时显示） ──────────────────────────────────
  introNote: {
    title: "Xalgo Voice 绑定",
    lines: [
      "请在 Xalgo App 点击「连接 OpenClaw」获取 8 位绑定码。",
      "绑定码 5 分钟内有效；累计失败 ≥5 次会作废，需在 App 重新生成。",
    ],
    shouldShow: ({ cfg }: any) => !hasCompleteXalgoBinding(resolveXalgoAccount(cfg)),
  },

  // ── 凭据输入（这里只收一个字段：绑定码） ────────────────────────────
  credentials: [
    {
      inputKey: "token",
      providerHint: "Xalgo Voice",
      credentialLabel: "8 位绑定码",
      envPrompt: "使用环境变量中的绑定码？",
      keepPrompt: "已绑定，保留当前 Channel Token？",
      inputPrompt: "请输入 8 位绑定码（字母+数字，不区分大小写）",
      inspect: ({ cfg }: any) => {
        const account = resolveXalgoAccount(cfg);
        const token = readNonEmptyString(account, "token");
        const configured = hasCompleteXalgoBinding(account);
        return {
          accountConfigured: configured,
          hasConfiguredValue: Boolean(token),
          resolvedValue: token || undefined,
        };
      },
      applySet: ({ cfg, resolvedValue }: any) => {
        // 用户输入的"token"实际是 8 位绑定码，暂存到 _pendingCode，
        // finalize 异步钩子里做真正的 exchange。
        setXalgoAccount(cfg, { _pendingCode: String(resolvedValue).trim().toUpperCase() });
        return cfg;
      },
    },
  ],

  // ── 完成钩子：异步换 token + 写完整 binding ─────────────────────────
  finalize: async ({ cfg }: any): Promise<{ cfg: any } | undefined> => {
    const account = resolveXalgoAccount(cfg);
    const pendingCode = readNonEmptyString(account, "_pendingCode");

    if (!pendingCode) return undefined; // 没新输入，跳过

    if (!CODE_REGEX.test(pendingCode)) {
      setXalgoAccount(cfg, { _pendingCode: "" });
      throw new Error(`绑定码格式不对（应为 8 位字母数字）: ${pendingCode}`);
    }

    const apiBaseUrl = readNonEmptyString(account, "apiBaseUrl") || DEFAULT_CONFIG.apiBaseUrl;
    const client = createRestClient(apiBaseUrl);

    // instance_id：首次绑定生成 UUID v4，后续复用
    const instanceId =
      readNonEmptyString(account, "instanceId") || `oc_${crypto.randomUUID()}`;

    let resp;
    try {
      resp = await client.exchange({
        code: pendingCode,
        instanceId,
        deviceLabel: `OpenClaw on ${os.hostname()}`,
        pluginVersion: PLUGIN_VERSION,
      });
    } catch (err) {
      setXalgoAccount(cfg, { _pendingCode: "" });
      if (err instanceof ExchangeError) {
        // endpoint_unsupported 是常见的"对接早期"错误，给一条人话提示
        if (err.type === "endpoint_unsupported") {
          throw new Error(
            `服务端尚未实现绑定接口（HTTP ${err.httpStatus} from ${err.requestUrl}）。\n` +
              `请联系后端对照 docs/api-contract.md 实现 ` +
              `POST /v1/openclaw/bindings/exchange 等 3 个 REST endpoint。\n` +
              `响应内容: ${err.responseBodySnippet ?? "(空)"}`,
          );
        }

        const parts = [`绑定失败 (${err.type})`];
        if (err.httpStatus !== undefined) parts.push(`HTTP ${err.httpStatus}`);
        if (err.requestUrl) parts.push(`url=${err.requestUrl}`);
        if (err.responseBodySnippet)
          parts.push(`body="${err.responseBodySnippet}"`);
        if (err.retryAfterSec)
          parts.push(`请 ${err.retryAfterSec}s 后重试`);
        throw new Error(parts.join(" | "));
      }
      throw err;
    }

    // exchange 成功 → 写入完整 binding 字段
    setXalgoAccount(cfg, {
      enabled: true,
      token: resp.channelToken,
      instanceId,
      boundAt: new Date().toISOString(),
      boundUserId: resp.userId,
      boundUserName: resp.userDisplayName,
      serverUrl: resp.wsUrl,
      apiBaseUrl,
      deviceLabel: `OpenClaw on ${os.hostname()}`,
      _pendingCode: "",
    });

    return { cfg };
  },

  // ── 完成提示 ───────────────────────────────────────────────────────
  completionNote: {
    title: "Xalgo Voice 绑定完成",
    lines: [
      "✓ 已绑定到 Xalgo 账号。",
      "重启 OpenClaw 让 channel 加载新配置：",
      "  openclaw gateway restart",
    ],
    shouldShow: ({ cfg }: any) => hasCompleteXalgoBinding(resolveXalgoAccount(cfg)),
  },

  // ── 禁用 ───────────────────────────────────────────────────────────
  disable: (cfg: any) => {
    setXalgoAccount(cfg, { enabled: false });
    return cfg;
  },
};
