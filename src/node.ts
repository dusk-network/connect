import { toBytes } from "./bytes.js";
import { normalizeBaseUrl, strip0x } from "./internal/normalize.js";

export type ContractCallOptions = {
  /**
   * If true, force feeder mode. If false, disable feeder mode.
   * If omitted, the client will try without feeder and retry with feeder
   * when the node asks for it.
   */
  feeder?: boolean;

  /** AbortSignal for the underlying fetch */
  signal?: AbortSignal;
};

export type WaitForTxExecutedOptions = {
  /**
   * How long to wait for the tx to be executed before returning `null`.
   * Default: 60_000ms.
   */
  timeoutMs?: number;

  /** AbortSignal to cancel the wait. */
  signal?: AbortSignal;
};

export type TxExecutedEvent = {
  /** RUES headers for the executed event */
  headers: Headers;
  /** Decoded payload if JSON, otherwise a Uint8Array */
  payload: unknown;
};

export type DuskNodeClient = {
  /** Resolved base URL (no trailing slash) */
  getBaseUrl(): string;

  /**
   * Call a contract endpoint via Rusk HTTP.
   *
   * @returns raw bytes (RKYV) returned by the node.
   */
  contractCall(contractId: string, fnName: string, body: Uint8Array | ArrayBuffer | number[] | string, opts?: ContractCallOptions): Promise<Uint8Array>;

  /**
   * Wait until a tx hash is reported as **Executed** by the node (RUES).
   *
   * This is the lightweight, event-driven alternative to polling `/on/graphql/query`.
   *
   * Returns `null` on timeout.
   */
  waitForTxExecuted(hash: string, opts?: WaitForTxExecutedOptions): Promise<TxExecutedEvent | null>;
};


// ------------------------------
// Fetch retry (read-only contract calls)
// ------------------------------


function normalizeContractIdForUrl(contractId: string): string {
  return strip0x(String(contractId || "").trim());
}

function shouldRetryWithFeeder(text: string): boolean {
  const t = String(text || "");
  // Nodes have historically returned error strings like "missing feed".
  // Some render it with spacing... keep it lenient.
  return /missing\s+feed/i.test(t) || /M\s*i\s*s\s*s\s*i\s*n\s*g\s+f\s*e\s*e\s*d/i.test(t);
}

// RUES is the node event-streaming protocol.
// We keep a tiny, dependency-free implementation here.
//
// Reference implementation: @dusk/w3sper (Deno + Browsers)
const RUES_VERSION = "1.0.0-rc.0";
const RUES_KEEP_ALIVE_MS = 30_000;

function toWsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/on";
  u.search = "";
  u.hash = "";
  return u.toString();
}

function parseRuesFrame(data: ArrayBuffer): { headers: Headers; payload: unknown } {
  // RUES frame format:
  // [u32 LE headers_len][headers_json_bytes][body_bytes]
  const view = new DataView(data);
  if (view.byteLength < 4) throw new Error("Invalid RUES frame");
  const headersLen = view.getUint32(0, true);
  if (4 + headersLen > view.byteLength) throw new Error("Invalid RUES headers length");

  const headersBytes = new Uint8Array(data, 4, headersLen);
  let headerPairs: any = [];
  try {
    headerPairs = JSON.parse(new TextDecoder().decode(headersBytes));
  } catch {
    headerPairs = [];
  }

  const headers = new Headers(headerPairs);
  const body = new Uint8Array(data, 4 + headersLen);
  const ct = String(headers.get("content-type") || "");

  // Try to decode JSON payloads, otherwise return bytes.
  if (/json/i.test(ct)) {
    try {
      return { headers, payload: JSON.parse(new TextDecoder().decode(body)) };
    } catch {
      // fall through
    }
  }

  return { headers, payload: body };
}

async function subscribeRues(
  f: typeof fetch,
  url: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers();
  headers.set("rusk-version", RUES_VERSION);
  headers.set("rusk-session-id", sessionId);

  const init: RequestInit = { method: "GET", headers };
  if (signal) init.signal = signal;

  const res = await f(url, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Unable to subscribe (${res.status} ${res.statusText})`);
  }
  // Subscription is established server-side; we don't need the body.
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
}

export function createDuskNodeClient(opts: {
  /** Base URL, e.g. https://testnet.nodes.dusk.network */
  baseUrl: string | (() => string);
  /** Optional fetch implementation for tests */
  fetch?: typeof fetch;
}): DuskNodeClient {
  const f = opts.fetch ?? fetch;

  const getBaseUrl = () => {
    const u = typeof opts.baseUrl === "function" ? opts.baseUrl() : opts.baseUrl;
    return normalizeBaseUrl(u);
  };

  const contractCall: DuskNodeClient["contractCall"] = async (contractId, fnName, body, callOpts = {}) => {
    const base = getBaseUrl();
    if (!base) {
      throw new Error("DuskNodeClient: baseUrl is empty");
    }

    const cid = normalizeContractIdForUrl(contractId);
    const url = `${base}/on/contracts:${cid}/${String(fnName)}`;

    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    // Be explicit: the SDK expects raw RKYV bytes back.
    headers.set("Accept", "application/octet-stream");

    const bodyBytes = toBytes(body);

    // Some TS lib combinations (DOM + older Node fetch typings) don't accept Uint8Array as
    // `RequestInit.body` even though it works at runtime. Normalize to an ArrayBuffer slice.
    const _buf = bodyBytes.buffer as ArrayBuffer;
    const bodyArrayBuffer = _buf.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength);

    const doFetch = async (feeder: boolean) => {
      if (feeder) headers.set("Rusk-feeder", "true");
      else headers.delete("Rusk-feeder");

      const init: RequestInit = {
        method: "POST",
        headers,
        body: bodyArrayBuffer,
      };
      if (callOpts.signal) init.signal = callOpts.signal;
// Retry a couple of times on transient gateway errors (testnet gateways can be flaky).
const retryable = [429, 502, 503, 504];
for (let i = 0; i < 3; i++) {
  try {
    const res = await f(url, init);
    if (res.ok || i === 2 || !retryable.includes(res.status)) return res;
    try { res.body?.cancel?.(); } catch { /* ignore */ }
  } catch (e) {
    // Abort should not retry.
    if (callOpts.signal?.aborted) throw e;
    if (i === 2) throw e;
  }
  await new Promise((r) => setTimeout(r, 250 * 2 ** i));
}
// Should never get here.
return await f(url, init);
    };

    // Respect explicit feeder choice.
    if (callOpts.feeder === true) {
      const res = await doFetch(true);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    if (callOpts.feeder === false) {
      const res = await doFetch(false);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }

    // Auto fallback: try non-feeder first.
    let res = await doFetch(false);
    if (!res.ok) {
      const txt = await res.text();
      if (shouldRetryWithFeeder(txt)) {
        res = await doFetch(true);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      } else {
        throw new Error(txt || `HTTP ${res.status}`);
      }
    }

    return new Uint8Array(await res.arrayBuffer());
  };

  const waitForTxExecuted: DuskNodeClient["waitForTxExecuted"] = async (hash, waitOpts = {}) => {
    const base = getBaseUrl();
    if (!base) throw new Error("DuskNodeClient: baseUrl is empty");

    const tx = strip0x(String(hash || "").trim()).toLowerCase();
    if (!tx) return null;

    if (typeof WebSocket === "undefined") {
      throw new Error("waitForTxExecuted requires WebSocket support (browser environment)");
    }

    const timeoutMs = Number(waitOpts.timeoutMs ?? 60_000);
    const signal = waitOpts.signal;

    const wsUrl = toWsUrl(base);
    const topicUrl = `${base}/on/transactions:${tx}/Executed`;

    // Best-effort event-driven wait: open a fresh session, subscribe to the tx topic,
    // then resolve on the first matching event.
    return await new Promise<TxExecutedEvent | null>((resolve, reject) => {
      let finished = false;
      let sessionId: string | null = null;
      let subscribed = false;
      let keepAliveId: any;
      let timeoutId: any;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      const cleanup = () => {
        if (finished) return;
        finished = true;

        if (timeoutId) clearTimeout(timeoutId);
        if (keepAliveId) clearInterval(keepAliveId);

        try {
          ws.close();
        } catch {
          // ignore
        }

        if (signal) signal.removeEventListener("abort", onAbort);
      };

      const fail = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const onAbort = () => {
        fail(signal?.reason ?? new Error("Aborted"));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      ws.addEventListener("error", () => fail(new Error("RUES websocket error")));
      ws.addEventListener("close", () => {
        // If we already resolved/rejected, ignore.
        if (finished) return;
        fail(new Error("RUES websocket closed"));
      });

      ws.addEventListener("message", async (ev) => {
        try {
          // The first ws message is the session id (string) in RUES.
          if (!sessionId) {
            sessionId = typeof ev.data === "string" ? ev.data : String(ev.data);

            keepAliveId = setInterval(() => {
              try {
                if (ws.readyState === WebSocket.OPEN) ws.send("");
              } catch {
                // ignore
              }
            }, RUES_KEEP_ALIVE_MS);

            await subscribeRues(f, topicUrl, sessionId, signal);
            subscribed = true;
            return;
          }

          if (!subscribed) return;
          if (!(ev.data instanceof ArrayBuffer)) return;

          const { headers, payload } = parseRuesFrame(ev.data);
          const loc = String(headers.get("content-location") || "").toLowerCase();

          // When subscribed to `/transactions:<id>/Executed` we *should* only get this tx,
          // but keep a small guard so we don't resolve on unrelated frames.
          if (!loc || !loc.includes(tx)) return;

          cleanup();
          resolve({ headers, payload });
        } catch (e) {
          fail(e);
        }
      });
    });
  };

  return { getBaseUrl, contractCall, waitForTxExecuted };
}