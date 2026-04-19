import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDuskNodeClient } from "./node.js";

function binaryResponse(bytes: number[], init: ResponseInit = {}) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
    ...init,
  });
}

function makeRuesFrame(headersInit: Record<string, string>, payload: unknown): ArrayBuffer {
  const enc = new TextEncoder();
  const headersJson = JSON.stringify(Object.entries(headersInit));
  const headerBytes = enc.encode(headersJson);
  const bodyBytes =
    headersInit["content-type"]?.includes("json") ?? false
      ? enc.encode(JSON.stringify(payload))
      : payload instanceof Uint8Array
      ? payload
      : enc.encode(String(payload ?? ""));

  const out = new Uint8Array(4 + headerBytes.length + bodyBytes.length);
  new DataView(out.buffer).setUint32(0, headerBytes.length, true);
  out.set(headerBytes, 4);
  out.set(bodyBytes, 4 + headerBytes.length);
  return out.buffer;
}

type Listener = (event?: any) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  binaryType = "blob";
  sent: any[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: any) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("node client", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useRealTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it("normalizes the base url and performs binary contract calls", async () => {
    const fetchMock = vi.fn(async () => binaryResponse([1, 2, 3]));
    const client = createDuskNodeClient({
      baseUrl: " https://nodes.dusk.network/ ",
      fetch: fetchMock as any,
    });

    const out = await client.contractCall("0xabc123", "balance_of", "0x0102");

    expect(client.getBaseUrl()).toBe("https://nodes.dusk.network");
    expect([...out]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://nodes.dusk.network/on/contracts:abc123/balance_of",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("retries with feeder mode when the node asks for it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing feed", { status: 400 }))
      .mockResolvedValueOnce(binaryResponse([9, 9]));

    const client = createDuskNodeClient({
      baseUrl: "https://nodes.dusk.network",
      fetch: fetchMock as any,
    });

    const out = await client.contractCall("0x" + "11".repeat(32), "foo", [1, 2, 3]);

    expect([...out]).toEqual([9, 9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(secondInit.headers).get("Rusk-feeder")).toBe("true");
  });

  it("retries transient gateway errors a few times", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 502 }))
      .mockResolvedValueOnce(new Response("still busy", { status: 503 }))
      .mockResolvedValueOnce(binaryResponse([7]));

    const client = createDuskNodeClient({
      baseUrl: "https://nodes.dusk.network",
      fetch: fetchMock as any,
    });

    await expect(client.contractCall("0x" + "22".repeat(32), "foo", "0x")).resolves.toEqual(
      new Uint8Array([7])
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits for an executed tx event over RUES", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("WebSocket", MockWebSocket as any);

    const client = createDuskNodeClient({
      baseUrl: "https://nodes.dusk.network",
      fetch: fetchMock as any,
    });

    const promise = client.waitForTxExecuted("0xdeadbeef", { timeoutMs: 500 });
    const ws = MockWebSocket.instances[0];
    expect(ws?.url).toBe("wss://nodes.dusk.network/on");

    ws!.emit("message", { data: "session-123" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://nodes.dusk.network/on/transactions:deadbeef/Executed",
      expect.objectContaining({
        method: "GET",
      })
    );

    ws!.emit("message", {
      data: makeRuesFrame(
        {
          "content-location": "/on/transactions:deadbeef/Executed",
          "content-type": "application/json",
        },
        { success: true, hash: "0xdeadbeef" }
      ),
    });

    await expect(promise).resolves.toMatchObject({
      payload: { success: true, hash: "0xdeadbeef" },
    });
  });

  it("returns null on tx wait timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket as any);

    const client = createDuskNodeClient({
      baseUrl: "https://nodes.dusk.network",
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as any,
    });

    const promise = client.waitForTxExecuted("0xabc", { timeoutMs: 50 });
    vi.advanceTimersByTime(50);

    await expect(promise).resolves.toBeNull();
  });

  it("supports aborting tx waits", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket as any);

    const client = createDuskNodeClient({
      baseUrl: "https://nodes.dusk.network",
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as any,
    });

    const controller = new AbortController();
    const promise = client.waitForTxExecuted("0xabc", {
      timeoutMs: 500,
      signal: controller.signal,
    });

    controller.abort(new Error("stop waiting"));

    await expect(promise).rejects.toThrow(/stop waiting/i);
  });
});
