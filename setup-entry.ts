import crypto from "node:crypto";
import os from "node:os";
import { createBindingStore, type StoreAdapter } from "./src/binding-store.js";
import { createRestClient, ExchangeError, type ExchangeErrorType } from "./src/rest-client.js";
import { createLogger } from "./src/logger.js";
import { DEFAULT_CONFIG } from "./src/config.js";

const log = createLogger("setup");

const PLUGIN_VERSION = "2026.5.16";
/** API Server 默认地址，与运行时配置 (DEFAULT_CONFIG.apiBaseUrl) 共用同一个 source of truth */
const DEFAULT_API_BASE_URL = DEFAULT_CONFIG.apiBaseUrl;
const CODE_REGEX = /^[A-Z0-9]{8}$/i;
// Base32 字符集 - 0/O/1/I/L/S/2/Z，再去掉 U/W 防混淆

const ERROR_MESSAGES: Record<ExchangeErrorType, string> = {
  invalid_code_format: "绑定码格式不对（8 位字母数字）",
  code_not_found: "绑定码无效，请检查输入或在 App 重新生成",
  code_attempts_exceeded: "尝试次数过多，请在 App 重新生成绑定码",
  code_expired: "绑定码已过期（5 分钟），请在 App 重新生成",
  code_consumed: "该绑定码已被使用过",
  instance_already_bound: "该 OpenClaw 实例已绑定到此账号",
  rate_limited: "请求过快，请稍后重试",
  network_error: "网络错误，请检查网络后重试",
  server_error: "服务暂时不可用",
  auth_failed: "鉴权失败",
  endpoint_unsupported:
    "服务端尚未实现该 API（HTTP 404/405），请联系后端对照 docs/api-contract.md 实现",
  unknown: "未知错误",
};

export interface SetupContext {
  prompt: (question: string) => Promise<string>;
  writeConfig: (key: string, value: unknown) => Promise<void>;
  readConfig?: (key: string) => Promise<unknown>;
  log: (msg: string) => void;
}

function makeAdapter(ctx: SetupContext): StoreAdapter {
  return {
    read: ctx.readConfig
      ? (k) => ctx.readConfig!(k)
      : async () => undefined,
    write: ctx.writeConfig,
  };
}

async function handleUnbind(
  ctx: SetupContext,
  store: ReturnType<typeof createBindingStore>,
  apiBaseUrl: string
): Promise<void> {
  const existing = await store.read();
  if (!existing) {
    ctx.log("当前没有绑定，无需解绑。");
    return;
  }
  const client = createRestClient(apiBaseUrl);
  ctx.log("正在解绑...");
  try {
    await client.unbind(existing.token, existing.instanceId);
    await store.clear();
    ctx.log("✓ 已解绑。");
  } catch (err) {
    if (err instanceof ExchangeError) {
      ctx.log(`⚠ 服务端解绑失败 (${err.type})，但本地配置已清空。`);
    } else {
      ctx.log(`⚠ 解绑出错: ${(err as Error).message}`);
    }
    await store.clear();
  }
}

/**
 * 检测 OpenClaw 传入的 context 是否包含绑定向导所需的三件套（prompt/writeConfig/log）。
 *
 * 重要背景：openclaw.setupEntry 字段被 OpenClaw 当作 plugin lifecycle 钩子，
 * 在 install / load 时会自动调用，但传入的 context 形状跟交互式向导不同（无 prompt
 * 等函数）。如果没有这些函数说明是 lifecycle 调用，直接退出避免崩溃；要触发真正
 * 的绑定向导，请通过独立 CLI 入口（详见 README）。
 */
function hasWizardContext(ctx: unknown): ctx is SetupContext {
  const c = ctx as Partial<SetupContext> | null;
  return (
    !!c &&
    typeof c.prompt === "function" &&
    typeof c.writeConfig === "function" &&
    typeof c.log === "function"
  );
}

export default async function setup(rawContext: unknown): Promise<void> {
  if (!hasWizardContext(rawContext)) {
    // OpenClaw lifecycle 加载时不带 wizard 上下文，安全返回不做任何 prompt
    log.debug("setup invoked without wizard context, skipping (lifecycle load)");
    return;
  }
  const context = rawContext;

  context.log("Museve Voice Channel 配置向导");
  context.log("────────────────────────────");
  context.log("");

  const store = createBindingStore(makeAdapter(context));
  const existing = await store.read();

  let apiBaseUrl = DEFAULT_API_BASE_URL;

  // 已绑定 → 询问操作
  if (existing) {
    context.log(`当前已绑定到: ${existing.boundUserName ?? "(未知)"} (${existing.boundUserId})`);
    context.log(`Instance ID: ${existing.instanceId.slice(0, 16)}...`);
    context.log(`绑定时间: ${existing.boundAt}`);
    context.log("");
    const action = await context.prompt("选择操作: [1] 保持现状  [2] 重新绑定  [3] 解绑");
    if (action.trim() === "1" || action.trim() === "") {
      context.log("保持现状。");
      return;
    }
    if (action.trim() === "3") {
      return await handleUnbind(context, store, apiBaseUrl);
    }
    // action === "2" → 走重新绑定
  }

  // 1. 读取/生成 instance_id
  let instanceId = existing?.instanceId;
  if (!instanceId) {
    instanceId = `oc_${crypto.randomUUID()}`;
    context.log(`生成新设备 ID: ${instanceId.slice(0, 16)}...`);
  }

  // 2. prompt 绑定码
  context.log("");
  context.log("请在 Museve App 中点击「连接 OpenClaw」获取 8 位绑定码。");
  const code = (await context.prompt("请输入绑定码:")).trim().toUpperCase();
  if (!code) {
    context.log("已取消。");
    return;
  }
  if (!CODE_REGEX.test(code)) {
    context.log(`✗ ${ERROR_MESSAGES.invalid_code_format}`);
    return;
  }

  // 3. prompt API base URL
  const apiInput = await context.prompt(
    `API Server 地址 (默认: ${DEFAULT_API_BASE_URL}):`
  );
  apiBaseUrl = apiInput.trim() || DEFAULT_API_BASE_URL;

  // 4. 调 exchange
  const client = createRestClient(apiBaseUrl);
  context.log("正在验证绑定码...");

  let resp;
  try {
    resp = await client.exchange({
      code,
      instanceId,
      deviceLabel: `OpenClaw on ${os.hostname()}`,
      pluginVersion: PLUGIN_VERSION,
    });
  } catch (err) {
    if (err instanceof ExchangeError) {
      context.log(`✗ ${ERROR_MESSAGES[err.type] ?? ERROR_MESSAGES.unknown}`);
      if (err.retryAfterSec) {
        context.log(`  请 ${err.retryAfterSec} 秒后重试`);
      }
    } else {
      context.log(`✗ 错误: ${(err as Error).message}`);
    }
    return;
  }

  // 5. 用户身份二次确认
  context.log("");
  context.log(`即将绑定到: ${resp.userDisplayName} (${resp.userId})`);
  const confirm = (await context.prompt("确认绑定吗？[y/N]:")).trim().toLowerCase();
  if (confirm !== "y" && confirm !== "yes") {
    context.log("已取消绑定，正在回滚服务端记录...");
    try {
      await client.unbind(resp.channelToken, instanceId);
    } catch (err) {
      context.log(`⚠ 回滚失败: ${(err as Error).message}`);
    }
    return;
  }

  // 6. 写盘
  await store.write({
    token: resp.channelToken,
    instanceId,
    boundAt: new Date().toISOString(),
    boundUserId: resp.userId,
    boundUserName: resp.userDisplayName,
    deviceLabel: `OpenClaw on ${os.hostname()}`,
  });
  await context.writeConfig("channels.museve_voice.enabled", true);
  await context.writeConfig("channels.museve_voice.apiBaseUrl", apiBaseUrl);
  await context.writeConfig("channels.museve_voice.serverUrl", resp.wsUrl);

  context.log("✓ 绑定成功，配置已保存。");
  context.log("  插件启动后会自动建立 WebSocket 连接。");
}
