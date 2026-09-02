# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

@museve/voice-openclaw-plugin — OpenClaw Channel 插件，让用户通过 Museve 眼镜语音实时控制自己的 OpenClaw Agent。插件作为 WebSocket 客户端主动连接 Museve Voice Channel Server，不需要 OpenClaw 暴露公网端口。

## 构建与运行

```bash
npm install          # 安装依赖
npm run build        # TypeScript 编译到 dist/
npm run dev          # watch 模式编译
npm run lint         # 类型检查 (tsc --noEmit)
```

## 测试

```bash
npm test                                      # 运行全部测试 (单元 + 集成)
npx vitest run test/unit/protocol.test.ts     # 运行单个测试文件
npx vitest run test/integration/              # 只运行集成测试
npx vitest --watch                            # watch 模式
```

集成测试使用内置的 Mock Server (`test/integration/mock-server.ts`)，不需要外部服务。

## 架构

三层分离，自底向上：

1. **Transport Layer** (`src/client.ts`, `src/reconnect.ts`)
   - WebSocket 客户端连接管理
   - 心跳 (ping/pong)，miss 3 次自动断开
   - 指数退避重连 (1s → 2s → 5s → 15s → 30s)
   - Resume (last_event_id) 恢复未投递事件

2. **Protocol Layer** (`src/protocol.ts`, `src/inbound.ts`, `src/outbound.ts`, `src/streaming.ts`, `src/confirmation.ts`, `src/interrupt.ts`, `src/delivery-ack.ts`, `src/session.ts`)
   - XVC (Museve Voice Channel Protocol) 事件类型定义与分发
   - 消息转换：Museve ↔ OpenClaw 格式互转
   - 流式回复：outbound_delta 序列管理
   - 确认状态机：pending/resolved/timeout，R3 禁止纯语音
   - 打断处理：cancel 当前输出 + playback ledger + follow-up 新意图
   - 投递确认追踪

3. **Channel Layer** (`src/channel.ts`, `index.ts`)
   - 通过 `api.registerChannel()` 注册到 OpenClaw
   - 实现 InboundAdapter / OutboundAdapter 接口
   - 事件分发到对应 Protocol 模块

## 关键设计决策

- 单 WebSocket 双向通信 — inbound/outbound 走同一个连接
- 所有事件有 event_id + idempotency_key — 重连回放不重复执行副作用
- R3 操作（删除/支付/公开发布）必须手机确认 — 配置项 `riskPolicy.allowPureVoiceR3` 默认 false
- 插件只存 channel token — 不保存 OpenClaw Gateway Token

## 语言

- 使用中文进行交流和注释
