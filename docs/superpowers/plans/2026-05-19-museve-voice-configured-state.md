# Museve Voice Configured State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenClaw mark `museve_voice` as configured/runnable when a complete binding exists, so the channel runtime starts and the plugin attempts the WebSocket connection.

**Architecture:** Follow the WeCom setup wizard pattern: centralize config resolution, define configured state as a validation over required credentials, and keep setup/status logic consistent with runtime binding requirements. Add focused diagnostics at the channel boundary so logs prove whether OpenClaw called `inbound.start`, which config was loaded, and whether the WebSocket client attempted to connect.

**Tech Stack:** TypeScript, OpenClaw channel plugin API, Vitest, `ws` WebSocket client.

---

## Reference findings

WeCom's open-source setup wizard (`WecomTeam/wecom-openclaw-plugin/src/onboarding.ts`) uses these patterns:

- `resolveConfigured` checks the actual required credentials after trimming, not just object presence.
- `inspect` returns `accountConfigured`, `hasConfiguredValue`, and `resolvedValue` from the same credential resolver.
- `finalize` enables the channel only after required credentials are complete.
- `disable` is non-destructive and only sets `enabled: false`.
- Config access is centralized behind helpers rather than repeated direct path reads.

Apply the same pattern to Museve Voice, with our required runtime binding fields: `enabled`, `token`, `instanceId`, `boundAt`, `boundUserId`, `serverUrl`, and `apiBaseUrl`.

## File structure

- Modify `src/onboarding.ts`
  - Add small helpers for resolving `channels.museve_voice` and validating complete binding state.
  - Use those helpers in `status.resolveConfigured`, `resolveStatusLines`, `introNote.shouldShow`, credential `inspect`, `completionNote.shouldShow`, and `finalize`.
- Modify `src/channel.ts`
  - Add runtime startup diagnostics.
  - Avoid reporting synthetic `ready` after `channel.start`, because real connectivity should come from `connecting`, `connected`, `disconnected`, `auth_failed`, or `unbound`.
  - Add an early unbound status when required binding fields are incomplete.
- Create `test/unit/onboarding.test.ts`
  - Cover configured-state decisions and setup wizard status behavior.
- Modify or create `test/unit/channel-start.test.ts`
  - Cover that a complete binding starts the channel without a trailing `ready` status and that incomplete binding reports `unbound` without attempting a WebSocket connection.

---

### Task 1: Add configured-state tests for onboarding

**Files:**
- Create: `test/unit/onboarding.test.ts`
- Modify: none

- [ ] **Step 1: Write the failing tests**

Create `test/unit/onboarding.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { museveVoiceSetupWizard } from "../../src/onboarding.js";

function makeCfg(channel: Record<string, unknown>) {
  return {
    channels: {
      museve_voice: channel,
    },
  };
}

describe("museveVoiceSetupWizard configured state", () => {
  it("treats a complete enabled binding as configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(true);
    expect(museveVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(true);
    expect(museveVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(false);
  });

  it("treats a disabled binding as not configured", () => {
    const cfg = makeCfg({
      enabled: false,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
  });

  it("treats partial binding data as not configured", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    expect(museveVoiceSetupWizard.status.resolveConfigured({ cfg })).toBe(false);
    expect(museveVoiceSetupWizard.completionNote.shouldShow({ cfg })).toBe(false);
    expect(museveVoiceSetupWizard.introNote.shouldShow({ cfg })).toBe(true);
  });

  it("credential inspect reports configured only for complete binding", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      boundAt: "2026-05-19T03:39:43.192Z",
      boundUserId: "default-user",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
      apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
    });

    const inspected = museveVoiceSetupWizard.credentials[0].inspect({ cfg });

    expect(inspected).toEqual({
      accountConfigured: true,
      hasConfiguredValue: true,
      resolvedValue: "xvc_live_abc",
    });
  });

  it("status lines mention missing required fields for partial binding", () => {
    const cfg = makeCfg({
      enabled: true,
      token: "xvc_live_abc",
      instanceId: "oc_123",
      serverUrl: "wss://asr-test.jlpay.com/agent-channel/connect",
    });

    const lines = museveVoiceSetupWizard.status.resolveStatusLines({
      cfg,
      configured: false,
    });

    expect(lines.join("\n")).toContain("缺少");
    expect(lines.join("\n")).toContain("boundAt");
    expect(lines.join("\n")).toContain("boundUserId");
    expect(lines.join("\n")).toContain("apiBaseUrl");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run test/unit/onboarding.test.ts
```

Expected: FAIL. At least `treats a disabled binding as not configured` should fail because current `resolveConfigured` only checks `token`, and partial binding status lines do not mention missing fields.

- [ ] **Step 3: Commit is not needed yet**

Do not commit after the failing test alone unless the user explicitly asks for granular commits.

---

### Task 2: Implement centralized binding completeness checks

**Files:**
- Modify: `src/onboarding.ts:22-192`
- Test: `test/unit/onboarding.test.ts`

- [ ] **Step 1: Add helper functions near the top of `src/onboarding.ts` after constants**

Replace the existing `ensureChannel` helper block at `src/onboarding.ts:22-27` with this code:

```ts
type MuseveChannelSetupConfig = Record<string, unknown>;

const REQUIRED_BINDING_FIELDS = [
  "token",
  "instanceId",
  "boundAt",
  "boundUserId",
  "serverUrl",
  "apiBaseUrl",
] as const;

/** 取/初始化 channel config 块 */
function ensureChannel(cfg: any): MuseveChannelSetupConfig {
  cfg.channels ??= {};
  cfg.channels[CHANNEL_ID] ??= {};
  return cfg.channels[CHANNEL_ID];
}

function resolveChannel(cfg: any): MuseveChannelSetupConfig {
  return cfg?.channels?.[CHANNEL_ID] ?? {};
}

function readNonEmptyString(channel: MuseveChannelSetupConfig, key: string): string {
  const value = channel[key];
  return typeof value === "string" ? value.trim() : "";
}

function missingBindingFields(channel: MuseveChannelSetupConfig): string[] {
  const missing = REQUIRED_BINDING_FIELDS.filter(
    (field) => !readNonEmptyString(channel, field),
  );
  if (channel.enabled !== true) missing.unshift("enabled");
  return missing;
}

function hasCompleteBinding(channel: MuseveChannelSetupConfig): boolean {
  return missingBindingFields(channel).length === 0;
}
```

- [ ] **Step 2: Update status helpers in `src/onboarding.ts`**

Replace `status` object body at `src/onboarding.ts:51-66` with this code:

```ts
  status: {
    configuredLabel: "已绑定 ✓",
    unconfiguredLabel: "需要 8 位绑定码",
    configuredHint: "已绑定到 Museve 账号",
    unconfiguredHint: "未绑定",
    resolveConfigured: ({ cfg }: any) => hasCompleteBinding(resolveChannel(cfg)),
    resolveStatusLines: ({ cfg, configured }: any) => {
      const channel = resolveChannel(cfg);
      if (configured) {
        return [
          `Museve Voice: 已绑定到 ${readNonEmptyString(channel, "boundUserName") || readNonEmptyString(channel, "boundUserId") || "(未知)"}`,
        ];
      }

      const missing = missingBindingFields(channel);
      return [
        missing.length > 0
          ? `Museve Voice: 未绑定或配置不完整（缺少 ${missing.join(", ")}）`
          : "Museve Voice: 未绑定（需要 8 位绑定码）",
      ];
    },
  },
```

- [ ] **Step 3: Update intro note and credential inspect**

Replace `introNote.shouldShow` at `src/onboarding.ts:75` with:

```ts
    shouldShow: ({ cfg }: any) => !hasCompleteBinding(resolveChannel(cfg)),
```

Replace the `inspect` function at `src/onboarding.ts:87-94` with:

```ts
      inspect: ({ cfg }: any) => {
        const channel = resolveChannel(cfg);
        const token = readNonEmptyString(channel, "token");
        const configured = hasCompleteBinding(channel);
        return {
          accountConfigured: configured,
          hasConfiguredValue: Boolean(token),
          resolvedValue: token || undefined,
        };
      },
```

- [ ] **Step 4: Update finalize defaults and completion note**

In `finalize`, replace:

```ts
    const apiBaseUrl = channel.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
```

with:

```ts
    const apiBaseUrl = readNonEmptyString(channel, "apiBaseUrl") || DEFAULT_CONFIG.apiBaseUrl;
```

Replace `completionNote.shouldShow` at `src/onboarding.ts:182-183` with:

```ts
    shouldShow: ({ cfg }: any) => hasCompleteBinding(resolveChannel(cfg)),
```

- [ ] **Step 5: Run onboarding tests and verify they pass**

Run:

```bash
npx vitest run test/unit/onboarding.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing setup tests to verify no regression**

Run:

```bash
npx vitest run test/unit/setup-entry.test.ts
```

Expected: PASS.

---

### Task 3: Add channel startup tests for complete vs incomplete binding

**Files:**
- Create: `test/unit/channel-start.test.ts`
- Modify: none

- [ ] **Step 1: Write the failing tests**

Create `test/unit/channel-start.test.ts` with this content:

```ts
import { describe, expect, it, vi } from "vitest";
import { createInboundAdapter } from "../../src/channel.js";

function makeCompleteConfig() {
  return {
    channels: {
      museve_voice: {
        enabled: true,
        token: "xvc_live_abc",
        instanceId: "oc_123",
        boundAt: "2026-05-19T03:39:43.192Z",
        boundUserId: "default-user",
        serverUrl: "ws://127.0.0.1:1",
        apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
        reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
      },
    },
  };
}

function makeReadConfig(channel: Record<string, unknown>) {
  return async (key: string) => {
    const field = key.split(".").pop()!;
    return channel[field];
  };
}

describe("createInboundAdapter startup", () => {
  it("does not emit a synthetic ready status after starting", async () => {
    const config = makeCompleteConfig();
    const statuses: string[] = [];
    const adapter = createInboundAdapter();

    await adapter.start({
      config,
      handleMessage: () => {},
      handleStatus: (status) => statuses.push(status.status),
      readConfig: makeReadConfig(config.channels.museve_voice),
      writeConfig: async () => {},
    });

    await adapter.stop();

    expect(statuses).toContain("connecting");
    expect(statuses).not.toContain("ready");
  });

  it("reports unbound and does not construct a websocket when required binding fields are missing", async () => {
    const config = {
      channels: {
        museve_voice: {
          enabled: true,
          token: "xvc_live_abc",
          instanceId: "oc_123",
          serverUrl: "ws://127.0.0.1:1",
          apiBaseUrl: "https://asr-test.jlpay.com/api/v1/agent-channel",
          reconnect: { minDelayMs: 1000, maxDelayMs: 1000, resume: true },
        },
      },
    };
    const statuses: string[] = [];
    const adapter = createInboundAdapter();

    await adapter.start({
      config,
      handleMessage: () => {},
      handleStatus: (status) => statuses.push(status.status),
      readConfig: makeReadConfig(config.channels.museve_voice),
      writeConfig: async () => {},
    });

    await adapter.stop();

    expect(statuses).toEqual(["unbound"]);
  });
});
```

- [ ] **Step 2: Run the tests and verify current behavior fails**

Run:

```bash
npx vitest run test/unit/channel-start.test.ts
```

Expected: FAIL. The first test should observe `ready` with current code, and the second may emit `connecting`/`auth_failed` instead of only `unbound`.

---

### Task 4: Fix channel startup lifecycle and diagnostics

**Files:**
- Modify: `src/channel.ts:15-214`
- Test: `test/unit/channel-start.test.ts`

- [ ] **Step 1: Add helper functions near the logger in `src/channel.ts`**

After `const log = createLogger("channel");`, insert:

```ts
const REQUIRED_BINDING_FIELDS = ["token", "instanceId", "boundAt", "boundUserId"] as const;

function readConfigString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function missingRuntimeBindingFields(config: Record<string, unknown>): string[] {
  return REQUIRED_BINDING_FIELDS.filter((field) => !readConfigString(config, field));
}

function describeRuntimeConfig(config: Record<string, unknown>): string {
  const serverUrl = readConfigString(config, "serverUrl") || "(missing)";
  const instanceId = readConfigString(config, "instanceId");
  const token = readConfigString(config, "token");
  const missing = missingRuntimeBindingFields(config);
  return [
    `serverUrl=${serverUrl}`,
    `token=${token ? "set" : "missing"}`,
    `instanceId=${instanceId || "missing"}`,
    `missing=${missing.length ? missing.join(",") : "none"}`,
  ].join(" ");
}
```

- [ ] **Step 2: Update `createInboundAdapter().start`**

Replace `src/channel.ts:203-214` inside `start` with this code:

```ts
      const museveConfig = config.channels?.museve_voice ?? config;
      const adapter: StoreAdapter = {
        read: readConfig ?? (async (k) => museveConfig[k.split(".").pop()!]),
        write: writeConfig ?? (async () => {
          log.warn("writeConfig not provided, binding updates will not persist");
        }),
      };
      const store = createBindingStore(adapter);
      const binding = await store.read();
      if (!binding) {
        log.warn(`Channel start skipped: incomplete binding ${describeRuntimeConfig(museveConfig)}`);
        handleStatus({ status: "unbound" });
        return;
      }

      log.info(`Channel start requested: ${describeRuntimeConfig(museveConfig)}`);
      channel = new MuseveVoiceChannel(museveConfig, store);
      await channel.start({ handleMessage, handleStatus });
```

This intentionally removes `handleStatus({ status: "ready" });` so OpenClaw receives real connection statuses from `XvcClient`.

- [ ] **Step 3: Run channel startup tests**

Run:

```bash
npx vitest run test/unit/channel-start.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run integration binding-flow test**

Run:

```bash
npx vitest run test/integration/binding-flow.test.ts
```

Expected: PASS. The happy path should still connect to the mock server and receive `connected`/control events.

---

### Task 5: Verify full project and document operational check

**Files:**
- Modify: none unless a test reveals a necessary correction

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run lint
```

Expected: PASS with `tsc --noEmit` errors absent.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS for all unit and integration tests.

- [ ] **Step 3: Build package**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` updated.

- [ ] **Step 4: Manual container verification after reinstall**

After installing the rebuilt plugin into the OpenClaw container and restarting OpenClaw, check status JSON. Expected change:

```json
"museve_voice": {
  "configured": true,
  "running": true,
  "lastStartAt": 1779162017919,
  "lastStopAt": null,
  "lastError": null
}
```

Filter container logs:

```bash
docker logs <openclaw-container-name> 2>&1 | grep -Ei "museve|museve-voice|WebSocket|binding|auth|channel"
```

Expected logs include:

```text
[museve-voice:channel] Channel start requested: serverUrl=wss://asr-test.jlpay.com/agent-channel/connect token=set instanceId=oc_... missing=none
[museve-voice:client] WebSocket connected
```

If service-side auth succeeds, expected status should later include `connected` or equivalent runtime online state. If logs show `WebSocket error`, continue debugging network/TLS. If logs show `Authentication failed`, continue debugging token/instance mismatch with the server.

---

## Self-review

- Spec coverage: The plan covers the observed `configured:false` state, aligns configured-state validation with runtime binding requirements, prevents synthetic `ready` from masking real connection state, and adds startup diagnostics for container logs.
- Placeholder scan: No TBD/TODO placeholders remain. Commands, expected outcomes, and code snippets are explicit.
- Type consistency: New helpers use `Record<string, unknown>` and existing exported `museveVoiceSetupWizard`/`createInboundAdapter` names. Status strings match current runtime strings plus existing `unbound` usage in `src/channel.ts`.
