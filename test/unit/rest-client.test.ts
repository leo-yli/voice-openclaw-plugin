import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ExchangeError, createRestClient } from "../../src/rest-client.js";

describe("ExchangeError", () => {
  it("carries type and optional retryAfterSec", () => {
    const e = new ExchangeError("code_expired");
    expect(e.type).toBe("code_expired");
    expect(e.retryAfterSec).toBeUndefined();
    expect(e instanceof Error).toBe(true);
    expect(e.message).toBe("code_expired");
  });

  it("carries retryAfterSec for rate_limited", () => {
    const e = new ExchangeError("rate_limited", 60);
    expect(e.type).toBe("rate_limited");
    expect(e.retryAfterSec).toBe(60);
  });
});

describe("RestClient.exchange", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed response on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          channel_token: "xvc_live_abc",
          token_prefix: "xvc_live_a",
          binding_id: "b_1",
          user_id: "u_1",
          user_display_name: "杨立",
          ws_url: "wss://x/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const client = createRestClient("https://api.example.com");
    const resp = await client.exchange({
      code: "A3FK9PQX",
      instanceId: "oc_uuid",
      deviceLabel: "host",
      pluginVersion: "2026.5.16",
    });

    expect(resp.channelToken).toBe("xvc_live_abc");
    expect(resp.userId).toBe("u_1");
    expect(resp.userDisplayName).toBe("杨立");
    expect(resp.wsUrl).toBe("wss://x/ws");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/exchange");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.code).toBe("A3FK9PQX");
    expect(body.instance_id).toBe("oc_uuid");
  });

  it("throws ExchangeError(code_expired) on 410 + error.type=code_expired", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "code_expired", title: "Code expired" }),
        { status: 410, headers: { "content-type": "application/problem+json" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "2026.5.16" })
    ).rejects.toMatchObject({ type: "code_expired" });
  });

  it("throws ExchangeError(rate_limited) with retryAfterSec from header on 429", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "rate_limited", title: "Too many" }),
        { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "30" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    const err = await client
      .exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "2026.5.16" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExchangeError);
    expect(err.type).toBe("rate_limited");
    expect(err.retryAfterSec).toBe(30);
  });

  it("retries on 500 up to 3 times then throws server_error", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "2026.5.16" })
    ).rejects.toMatchObject({ type: "server_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20000);

  it("throws network_error on fetch rejection", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createRestClient("https://api.example.com");
    await expect(
      client.exchange({ code: "A3FK9PQX", instanceId: "oc_x", deviceLabel: "h", pluginVersion: "2026.5.16" })
    ).rejects.toMatchObject({ type: "network_error" });
  });
});

describe("RestClient.rotate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns new token on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ channel_token: "xvc_live_new", token_prefix: "xvc_live_n", rotated_at: "2026-05-15T00:00:00Z" }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = createRestClient("https://api.example.com");
    const result = await client.rotate("old", "oc_uuid");
    expect(result.channelToken).toBe("xvc_live_new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/rotate");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer old");
    expect((init.headers as Record<string, string>)["x-instance-id"]).toBe("oc_uuid");
  });

  it("throws auth_failed on 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "auth_failed" }), { status: 401 })
    );
    const client = createRestClient("https://api.example.com");
    await expect(client.rotate("bad", "oc_uuid")).rejects.toMatchObject({ type: "auth_failed" });
  });
});

describe("RestClient.unbind", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves silently on 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createRestClient("https://api.example.com");
    await expect(client.unbind("t", "oc_uuid")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/openclaw/bindings/me");
    expect(init.method).toBe("DELETE");
  });

  it("throws on 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "auth_failed" }), { status: 401 })
    );
    const client = createRestClient("https://api.example.com");
    await expect(client.unbind("bad", "oc_uuid")).rejects.toMatchObject({ type: "auth_failed" });
  });
});
