#!/usr/bin/env node
/**
 * Museve Voice 绑定向导 CLI。
 *
 * 用户在 OpenClaw 主机上运行：
 *
 *   museve-bind                    # 如果走 npm install bin 注册
 *   # 或绝对路径
 *   node ~/.openclaw/extensions/museve_voice/dist/bin/museve-bind.js
 *
 * 流程：
 *   1. 读 ~/.openclaw/openclaw.json
 *   2. 如果已绑定，问操作：保持 / 重新绑定 / 解绑
 *   3. 否则 prompt 8 位绑定码 → API 地址 → 调 exchange → 二次确认
 *   4. 写入 channels.museve_voice.* 路径
 *   5. 提示重启 OpenClaw
 *
 * 配置存储路径采用 `channels.<channel_id>.*` —— 与 binding-store.ts 的 KEYS
 * 常量一致，也与 wecom 官方插件的 `openclaw config set channels.wecom.*`
 * 使用方式对齐。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import crypto from "node:crypto";
import os from "node:os";
import { createRestClient, ExchangeError } from "../src/rest-client.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const PLUGIN_VERSION = "2026.5.16";
const CHANNEL_KEY = "museve_voice";
const CODE_REGEX = /^[A-Z0-9]{8}$/i;
const CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

interface ChannelConfig {
  enabled?: boolean;
  token?: string;
  instanceId?: string;
  boundAt?: string;
  boundUserId?: string;
  boundUserName?: string;
  deviceLabel?: string;
  serverUrl?: string;
  apiBaseUrl?: string;
  [key: string]: unknown;
}

interface OpenClawConfig {
  channels?: Record<string, ChannelConfig>;
  [key: string]: unknown;
}

function readOpenClawConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`✗ OpenClaw 配置文件不存在：${CONFIG_PATH}`);
    console.error("  请先运行 OpenClaw 初始化命令（例如 'openclaw setup --wizard'）。");
    exit(1);
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as OpenClawConfig;
  } catch (err) {
    console.error(`✗ 解析 ${CONFIG_PATH} 失败：${(err as Error).message}`);
    exit(1);
  }
}

function writeOpenClawConfig(cfg: OpenClawConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function ensureChannelConfig(cfg: OpenClawConfig): ChannelConfig {
  cfg.channels ??= {};
  cfg.channels[CHANNEL_KEY] ??= {};
  return cfg.channels[CHANNEL_KEY];
}

async function main(): Promise<void> {
  console.log("");
  console.log("╭─────────────────────────────────╮");
  console.log("│   Museve Voice 绑定向导          │");
  console.log("╰─────────────────────────────────╯");
  console.log("");

  const cfg = readOpenClawConfig();
  const channel = ensureChannelConfig(cfg);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = (q: string): Promise<string> => rl.question(q + " ");

  try {
    // 已绑定 → 询问下一步
    if (channel.token && channel.instanceId) {
      console.log(
        `当前已绑定到: ${channel.boundUserName ?? "(未知)"} (${channel.boundUserId ?? "?"})`,
      );
      console.log(`Instance ID: ${channel.instanceId.slice(0, 16)}...`);
      console.log(`绑定时间: ${channel.boundAt ?? "(未知)"}`);
      console.log("");
      const action = (
        await ask("操作: [1] 保持现状  [2] 重新绑定  [3] 解绑")
      ).trim();

      if (action === "" || action === "1") {
        console.log("保持现状。");
        return;
      }
      if (action === "3") {
        await handleUnbind(channel);
        delete channel.enabled;
        delete channel.token;
        delete channel.instanceId;
        delete channel.boundAt;
        delete channel.boundUserId;
        delete channel.boundUserName;
        writeOpenClawConfig(cfg);
        console.log("✓ 已解绑，本地配置已清空。");
        console.log("  请重启 OpenClaw 让 channel 进入未绑定状态。");
        return;
      }
      // action === "2" 走重新绑定逻辑
    }

    // 1. 生成或复用 instance_id
    let instanceId = channel.instanceId;
    if (!instanceId) {
      instanceId = `oc_${crypto.randomUUID()}`;
      console.log(`生成新设备 ID: ${instanceId.slice(0, 16)}...`);
    }

    // 2. prompt 绑定码
    console.log("");
    console.log("请在 Museve App 点击「连接 OpenClaw」获取 8 位绑定码。");
    const code = (await ask("请输入绑定码:")).trim().toUpperCase();
    if (!code) {
      console.log("已取消。");
      return;
    }
    if (!CODE_REGEX.test(code)) {
      console.error("✗ 绑定码格式不对（应为 8 位字母数字）");
      exit(1);
    }

    // 3. prompt API base URL
    const defaultApi = DEFAULT_CONFIG.apiBaseUrl;
    const apiInput = await ask(`API Server 地址 (默认 ${defaultApi}):`);
    const apiBaseUrl = apiInput.trim() || defaultApi;

    // 4. 调 exchange
    console.log("正在验证绑定码...");
    const client = createRestClient(apiBaseUrl);

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
        console.error(
          `✗ ${err.type}` +
            (err.retryAfterSec ? `（请 ${err.retryAfterSec}s 后重试）` : ""),
        );
      } else {
        console.error(`✗ ${(err as Error).message}`);
      }
      exit(1);
    }

    // 5. 二次确认用户身份
    console.log("");
    console.log(`即将绑定到: ${resp.userDisplayName} (${resp.userId})`);
    const confirm = (await ask("确认绑定吗？[y/N]:")).trim().toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      console.log("已取消绑定，正在回滚服务端记录...");
      try {
        await client.unbind(resp.channelToken, instanceId);
      } catch {
        /* swallow */
      }
      return;
    }

    // 6. 写入 OpenClaw config
    channel.enabled = true;
    channel.token = resp.channelToken;
    channel.instanceId = instanceId;
    channel.boundAt = new Date().toISOString();
    channel.boundUserId = resp.userId;
    channel.boundUserName = resp.userDisplayName;
    channel.serverUrl = resp.wsUrl;
    channel.apiBaseUrl = apiBaseUrl;
    channel.deviceLabel = `OpenClaw on ${os.hostname()}`;

    writeOpenClawConfig(cfg);

    console.log("");
    console.log("✓ 绑定成功！");
    console.log(`  配置已写入 ${CONFIG_PATH}`);
    console.log(`  channels.${CHANNEL_KEY}.token = ${resp.tokenPrefix}****`);
    console.log("");
    console.log("下一步：重启 OpenClaw 让插件加载新配置");
    console.log("  openclaw gateway restart    # 或对应的 systemctl 命令");
  } finally {
    rl.close();
  }
}

async function handleUnbind(channel: ChannelConfig): Promise<void> {
  if (!channel.token || !channel.instanceId) return;
  const apiBaseUrl = channel.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
  const client = createRestClient(apiBaseUrl);
  try {
    await client.unbind(channel.token, channel.instanceId);
    console.log("✓ 服务端已解绑");
  } catch (err) {
    console.log(
      `⚠ 服务端解绑失败 (${(err as Error).message})，本地配置仍会清空`,
    );
  }
}

main().catch((err) => {
  console.error("绑定向导异常:", err);
  exit(1);
});
