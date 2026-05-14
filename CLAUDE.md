# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

@xalgo/voice-openclaw-plugin — OpenClaw Channel 插件，通过 Xalgo 眼镜语音控制 OpenClaw Agent。

## 构建与运行

```bash
npm install          # 安装依赖
npm run build        # TypeScript 编译到 dist/
npm run dev          # watch 模式
npm run lint         # 类型检查 (tsc --noEmit)
```

## 测试

```bash
npm test             # 运行全部测试
npx vitest run test/unit/protocol.test.ts   # 单个测试文件
npx vitest --watch   # watch 模式
```

## 架构

三层分离：
- **Channel Layer** (`src/channel.ts`, `index.ts`) — OpenClaw 标准 Channel Plugin 注册
- **Protocol Layer** (`src/protocol.ts`, `src/inbound.ts`, `src/outbound.ts`, `src/confirmation.ts`, `src/interrupt.ts`, `src/streaming.ts`, `src/delivery-ack.ts`) — XVC 协议事件处理
- **Transport Layer** (`src/client.ts`, `src/reconnect.ts`) — WebSocket 连接管理

## 语言

- 使用中文进行交流和注释
