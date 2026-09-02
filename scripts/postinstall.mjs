#!/usr/bin/env node
/**
 * postinstall hook —— 在 OpenClaw 装插件依赖跑完之后给用户提示下一步。
 *
 * 设计取舍：不在这里自动 spawn 绑定向导。原因：
 *   1. OpenClaw `plugins install .` 的子 npm install 流程没在前台 TTY 上
 *   2. spawn 一个 readline 子进程会跟父进程争 stdin，容易卡死
 *   3. CI / unattended install 不应被交互 prompt 阻塞
 *
 * 所以这里只打印醒目的"下一步"指引。用户复制粘贴就行。
 *
 * 仅在 OpenClaw extensions 目录下运行的 npm install 才打印（避免污染本地
 * 开发环境的 npm install 输出）。
 */

import { join } from "node:path";

const cwd = process.cwd();

// 检测是不是在 OpenClaw 的 extensions 目录下被装的
//   典型路径：/root/.openclaw/extensions/museve_voice
//   开发路径：/home/user/voice-openclaw-plugin
const isOpenClawInstall =
  cwd.includes(".openclaw") &&
  (cwd.includes("extensions") || cwd.includes("store"));

if (!isOpenClawInstall) {
  // 开发场景：什么都不做
  process.exit(0);
}

const cliPath = join(cwd, "dist", "bin", "museve-bind.js");

console.log("");
console.log(
  "════════════════════════════════════════════════════════════════════",
);
console.log("  ✓ @museve/voice-openclaw-plugin installed.");
console.log("");
console.log("  下一步：跑绑定向导收集 Museve App 给你的 8 位绑定码 ↓↓↓");
console.log("");
console.log("    node " + cliPath);
console.log("");
console.log("  绑定完成后重启 OpenClaw 让 channel 加载新配置：");
console.log("");
console.log("    openclaw gateway restart");
console.log(
  "════════════════════════════════════════════════════════════════════",
);
console.log("");
