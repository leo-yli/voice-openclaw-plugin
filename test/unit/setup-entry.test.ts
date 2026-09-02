import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import setup from "../../setup-entry.js";

function makeContext(prompts: string[]) {
  const storage: Record<string, unknown> = {};
  const logs: string[] = [];
  let promptIdx = 0;

  return {
    storage,
    logs,
    context: {
      prompt: async (_q: string) => prompts[promptIdx++] ?? "",
      writeConfig: async (k: string, v: unknown) => {
        storage[k] = v;
      },
      readConfig: async (k: string) => storage[k],
      log: (m: string) => logs.push(m),
    },
  };
}

describe("setup-entry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: prompt code → exchange → confirm → write config", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          channel_token: "xvc_live_xyz",
          token_prefix: "xvc_live_x",
          binding_id: "b_1",
          user_id: "u_1",
          user_display_name: "杨立",
          ws_url: "wss://example.com/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { storage, logs, context } = makeContext([
      "A3FK9PQX",
      "",
      "y",
    ]);

    await setup(context);

    expect(storage["channels.museve_voice.token"]).toBe("xvc_live_xyz");
    expect(storage["channels.museve_voice.boundUserId"]).toBe("u_1");
    expect(storage["channelAccounts.museve_voice.token"]).toBeUndefined();
    expect(storage["channelAccounts.museve_voice.boundUserId"]).toBeUndefined();
    expect(storage["channelAccounts.museve_voice.serverUrl"]).toBeUndefined();
    expect(typeof storage["channels.museve_voice.instanceId"]).toBe("string");
    expect((storage["channels.museve_voice.instanceId"] as string).startsWith("oc_")).toBe(true);
    expect(logs.some((l) => l.includes("绑定成功") || l.includes("已保存"))).toBe(true);
  });

  it("user declines confirmation → calls unbind to rollback", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            channel_token: "xvc_live_xyz",
            token_prefix: "xvc_live_x",
            binding_id: "b_1",
            user_id: "u_1",
            user_display_name: "Other",
            ws_url: "wss://example.com/ws",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { storage, context } = makeContext(["A3FK9PQX", "", "n"]);

    await setup(context);

    expect(storage["channels.museve_voice.token"]).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("expired code → log error and abort without writing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "code_expired" }), {
        status: 410,
        headers: { "content-type": "application/problem+json" },
      })
    );

    const { storage, logs, context } = makeContext(["A3FK9PQX", ""]);

    await setup(context);

    expect(storage["channels.museve_voice.token"]).toBeFalsy();
    expect(logs.some((l) => l.includes("已过期"))).toBe(true);
  });

  it("empty code input → abort silently", async () => {
    const { storage, context } = makeContext([""]);
    await setup(context);
    expect(storage["channels.museve_voice.token"]).toBeFalsy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalid code format (length != 8) → log error and abort", async () => {
    const { storage, logs, context } = makeContext(["SHORT"]);
    await setup(context);
    expect(storage["channels.museve_voice.token"]).toBeFalsy();
    expect(logs.some((l) => l.includes("格式"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("existing binding + action=1 (keep) → no changes", async () => {
    const { storage, context } = makeContext(["1"]);
    storage["channels.museve_voice.token"] = "old_token";
    storage["channels.museve_voice.instanceId"] = "oc_existing";
    storage["channels.museve_voice.boundAt"] = "2026-05-14T00:00:00Z";
    storage["channels.museve_voice.boundUserId"] = "u_old";

    await setup(context);

    expect(storage["channels.museve_voice.token"]).toBe("old_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
