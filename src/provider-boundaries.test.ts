import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createDuskApp } from "./app.js";
import { createDuskNodeClient } from "./node.js";
import { createDuskWallet, type DuskWalletOptions } from "./wallet.js";
import { createMockProvider } from "./test/mocks.js";

// Exercise the real app -> contract -> node transport; only the WASM codec is stubbed.
vi.mock("./driver.js", () => ({
  fetchWasmDataDriver: async () => ({
    encodeInputFn: () => new Uint8Array([1]),
    decodeOutputFn: (_name: string, bytes: Uint8Array) => [...bytes],
  }),
}));

const contract = { contractId: "0x" + "11".repeat(32), driverUrl: "/driver.wasm" };
const fallback = "https://app-node.example";
const unsafeUrls = [
  "javascript:alert(1)", "data:text/plain,node", "file:///etc/passwd", "/relative",
  "http://169.254.169.254/latest/meta-data/", "http://192.168.1.2", "http://localhost.evil.test",
  "http://127.0.0.1.evil.test", "https://user:pass@node.example", "https://node.example/#fragment",
  "https://node.example/?query=yes", "https://node.example/?", "https://node.example/#", "", 42, null,
];
const reads = ["dusk_getCapabilities", "dusk_chainId", "dusk_profiles"];

function walletFor(provider: ReturnType<typeof createMockProvider>, opts: Partial<DuskWalletOptions> = {}) {
  const wallet = createDuskWallet({ provider, waitForProvider: false, ...opts });
  onTestFinished(() => wallet.destroy());
  return wallet;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("provider value boundaries", () => {
  it.each(unsafeUrls)("never routes app reads to an invalid capability/event URL: %j", async (nodeUrl) => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([2])));
    vi.stubGlobal("fetch", fetch);
    const provider = createMockProvider({ capabilities: { nodeUrl: nodeUrl as string } });
    const wallet = walletFor(provider);
    const app = createDuskApp({ wallet, nodeUrl: fallback });
    await app.ready();
    expect(wallet.state.node).toBeNull();
    expect(app.nodeUrl()).toBe(fallback);

    provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl: "https://previous.example", networkName: "Previous" });
    provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl: nodeUrl as string, networkName: "Untrusted" });
    expect(wallet.state.node).toBeNull(); // Clear the previous URL too.
    await expect(app.readContract({ contract, functionName: "read" })).resolves.toEqual([2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${fallback}/on/contracts:${"11".repeat(32)}/read`);

    // Validate again at the transport boundary, including dynamic base URL resolvers.
    const node = createDuskNodeClient({ baseUrl: () => nodeUrl as string, fetch: fetch as typeof globalThis.fetch });
    await expect(node.contractCall("11".repeat(32), "read", new Uint8Array())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => createDuskApp({ nodeUrl: nodeUrl as string })).toThrow(TypeError);
    expect(() => createDuskApp({ pinnedNodeUrl: nodeUrl as string })).toThrow(TypeError);
    await expect(app.ensureChain({ nodeUrl: nodeUrl as string })).rejects.toThrow();
    expect(provider.request.mock.calls.some(([arg]) => arg.method === "dusk_switchNetwork")).toBe(false);
  });

  it.each([
    [" HTTPS://NODE.EXAMPLE:443/path/// ", "https://node.example/path"],
    ["https:node.example", "https://node.example"],
    ["https:\\node.example", "https://node.example"],
    ["http://localhost:9000/", "http://localhost:9000"],
    ["http://127.12.34.56:9000/", "http://127.12.34.56:9000"],
    ["http://[::1]:9000/", "http://[::1]:9000"],
  ])("accepts and normalizes supported node URLs: %s", async (nodeUrl, expected) => {
    const provider = createMockProvider({ capabilities: { nodeUrl } });
    const wallet = walletFor(provider);
    await wallet.ready();
    expect(wallet.state.node?.nodeUrl).toBe(expected);
    provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl, networkName: "Custom" });
    expect(wallet.state.node).toEqual({ chainId: "dusk:2", nodeUrl: expected, networkName: "Custom" });
    const app = createDuskApp({ wallet, pinnedNodeUrl: nodeUrl });
    expect(app.nodeUrl()).toBe(expected);
  });

  it("keeps explicit read pinning across capabilities, node changes and contract writes", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([2])));
    vi.stubGlobal("fetch", fetch);
    const provider = createMockProvider({ authorized: true, responses: {
      dusk_sendTransaction: { hash: "0x" + "ab".repeat(32), nonce: "1" },
    } });
    const wallet = walletFor(provider);
    const app = createDuskApp({ wallet, nodeUrl: "https://fallback.example", pinnedNodeUrl: fallback + "/" });
    await app.ready();
    expect(app.nodeUrl()).toBe(fallback);
    provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl: "https://other.example", networkName: "Other" });
    expect(wallet.state.node?.nodeUrl).toBe("https://other.example");
    expect(app.nodeUrl()).toBe(fallback);
    await app.readContract({ contract, functionName: "read" });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${fallback}/on/contracts:${"11".repeat(32)}/read`);
    const handle = await app.writeContract({ contract, functionName: "write", privacy: "public" });
    await expect(handle.wait()).rejects.toMatchObject({ name: "DuskTxTrackingUnavailableError" });
    expect(fetch).toHaveBeenCalledTimes(1); // Do not silently track the wallet's different node.
  });

  it("normalizes node targets consistently for chain checks and transaction origin matching", async () => {
    const provider = createMockProvider({ authorized: true, capabilities: { nodeUrl: "https://NODE.EXAMPLE:443/" } });
    const wallet = walletFor(provider);
    const app = createDuskApp({ wallet, pinnedNodeUrl: "https://node.example" });
    await app.ready();
    await expect(app.ensureChain({ nodeUrl: "https://NODE.EXAMPLE:443/" })).resolves.toBe(false);
    expect(provider.request.mock.calls.some(([arg]) => arg.method === "dusk_switchNetwork")).toBe(false);
    const handle = await app.writeContract({ contract, functionName: "write", privacy: "public", chain: { nodeUrl: "https://NODE.EXAMPLE:443/" } });
    expect(handle.origin.nodeUrl).toBe("https://node.example");
    provider.setResponse("dusk_switchNetwork", null);
    await expect(app.ensureChain({ nodeUrl: "https:other.example" })).resolves.toBe(true);
    expect(provider.request).toHaveBeenLastCalledWith({ method: "dusk_switchNetwork", params: [{ nodeUrl: "https://other.example" }] });
  });

  it.each([23, { arbitrary: true }, ["dusk:3"]])("guards chain IDs at every state ingress: %j", async (invalid) => {
    const provider = createMockProvider({ chainId: invalid as string, capabilities: { chainId: invalid as string } });
    const wallet = walletFor(provider);
    expect(wallet.state.chainId).toBeNull(); // Synchronous explicit-provider hydration.
    await wallet.ready();
    expect(wallet.state.chainId).toBeNull(); // RPC and property fallbacks.
    expect(wallet.state.node).toBeNull();
    provider.setChainId("dusk:2");
    provider.emit("duskNodeChanged", { chainId: invalid as string, nodeUrl: fallback, networkName: "Bad chain" });
    expect(wallet.state.chainId).toBe("dusk:2");
    expect(wallet.state.node).toBeNull();
    provider.emit("chainChanged", invalid as string);
    expect(wallet.state.chainId).toBe("dusk:2");
    provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl: fallback, networkName: invalid as string });
    expect(wallet.state.node?.networkName).toBe("");
  });

  it("does not coerce a non-boolean authorization property into a grant", async () => {
    const provider = createMockProvider({ authorized: "false" as unknown as boolean });
    const wallet = walletFor(provider);
    expect(wallet.state.authorized).toBe(false);
    await wallet.ready();
    expect(wallet.state.authorized).toBe(false);
    provider.emit("connect", { chainId: "dusk:2" });
    await wallet.refresh();
    expect(wallet.state.authorized).toBe(false);
  });

  it.each(["dusk:99999", 42, { arbitrary: true }])("uses connect events only to reread the provider, not authorize it: %j", async (chainId) => {
    const provider = createMockProvider();
    const wallet = walletFor(provider, { autoRefresh: false });
    await wallet.ready();
    provider.emit("connect", { chainId: chainId as string });
    expect(wallet.state).toMatchObject({ authorized: false, chainId: "dusk:2", profiles: [] });
    await wallet.refresh();
    expect(provider.request.mock.calls.map(([arg]) => arg.method)).toEqual(reads);
    expect(wallet.state).toMatchObject({ authorized: false, chainId: "dusk:2", profiles: [] });
  });
});

describe("bounded non-interactive provider reads", () => {
  it.each(["unsupported", "omitted", "invalid"].flatMap(node =>
    ["nodeUrl", "pinnedNodeUrl"].map(option => ({ node, option }))))(
    "writes after startup recovery with $node capabilities and $option", async ({ node, option }) => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => new Response(new Uint8Array([2])));
      vi.stubGlobal("fetch", fetch);
      const provider = createMockProvider({ responses: { dusk_getCapabilities: { then() {} } } });
      const wallet = walletFor(provider, { providerReadTimeoutMs: 25 });
      const app = createDuskApp({ wallet, [option]: fallback });
      const startup = app.ready().catch(error => error);
      await vi.advanceTimersByTimeAsync(25);
      const error = await startup;
      expect(error).toMatchObject({ name: "DuskWalletRequestTimeoutError", data: { method: "dusk_getCapabilities", timeoutMs: 25 } });
      provider.setResponse("dusk_getCapabilities", () => {
        if (node === "unsupported") throw Object.assign(new Error("Unsupported"), { code: 4200 });
        return { chainId: "dusk:2", ...(node === "invalid" ? { nodeUrl: "file:///node" } : {}) };
      });
      await wallet.refresh();
      expect(wallet.state.node).toBeNull();
      expect(wallet.state.chainId).toBe("dusk:2");
      expect(app.nodeUrl()).toBe(fallback);
      await expect(app.readContract({ contract, functionName: "read" })).resolves.toEqual([2]);
      expect(fetch.mock.calls[0]?.[0]).toBe(`${fallback}/on/contracts:${"11".repeat(32)}/read`);
      provider.request.mockClear();
      const writing = app.writeContract({ contract, functionName: "write", privacy: "public", chain: { chainId: "dusk:2" } });
      await expect(writing).resolves.toMatchObject({ hash: "0xtxhash" });
      const handle = await writing;
      const methods = provider.request.mock.calls.map(([arg]) => arg.method);
      expect(methods.filter(method => method === "dusk_requestProfiles")).toHaveLength(1);
      expect(methods.filter(method => method === "dusk_sendTransaction")).toHaveLength(1);
      expect(handle.origin.nodeUrl).toBe("");
      await expect(handle.wait()).rejects.toMatchObject({ name: "DuskTxTrackingUnavailableError" });
      await expect(app.ready()).rejects.toBe(error); // Recovery does not rewrite initial readiness.
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["hydrate", "timeout"])("still waits for pending startup to %s before a contract write", async outcome => {
    vi.useFakeTimers();
    const caps = deferred<unknown>();
    const provider = createMockProvider({ authorized: true, responses: { dusk_getCapabilities: () => caps.promise } });
    const wallet = walletFor(provider, { providerReadTimeoutMs: 25 });
    const app = createDuskApp({ wallet, nodeUrl: fallback });
    const startup = app.ready().catch(error => error);
    const settled = vi.fn();
    const writing = app.writeContract({ contract, functionName: "write", privacy: "public" }).then(settled, settled);
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).not.toHaveBeenCalled();
    expect(provider.request.mock.calls.some(([arg]) => arg.method === "dusk_sendTransaction")).toBe(false);
    if (outcome === "hydrate") {
      caps.resolve({ chainId: "dusk:2", nodeUrl: fallback });
      await writing;
      await expect(startup).resolves.toBe(wallet);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ hash: "0xtxhash", origin: expect.objectContaining({ nodeUrl: fallback }) }));
    } else {
      await vi.advanceTimersByTimeAsync(1);
      const error = await startup;
      await writing;
      expect(error).toMatchObject({ name: "DuskWalletRequestTimeoutError" });
      expect(settled).toHaveBeenCalledWith(error);
      expect(provider.request.mock.calls.some(([arg]) => arg.method === "dusk_sendTransaction")).toBe(false);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(reads)("rejects ready when %s returns a never-settling thenable", async (method) => {
    vi.useFakeTimers();
    const provider = createMockProvider({ responses: { [method]: { then() {} } } });
    const wallet = walletFor(provider, { providerReadTimeoutMs: 25 });
    const settled = vi.fn();
    const ready = wallet.ready().then(() => settled("ready"), settled);
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({
      name: "DuskWalletRequestTimeoutError", data: { method, timeoutMs: 25 },
    }));
    await ready;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has a finite default even if callers do not await ready until after the deadline", async () => {
    vi.useFakeTimers();
    const provider = createMockProvider({ responses: { dusk_profiles: { then() {} } } });
    const wallet = walletFor(provider);
    await vi.advanceTimersByTimeAsync(10_000);
    const settled = vi.fn();
    wallet.ready().then(() => settled("ready"), settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({
      name: "DuskWalletRequestTimeoutError", data: { method: "dusk_profiles", timeoutMs: 10_000 },
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)("shares refresh deadlines, ignores late %s and allows retry", async (completion) => {
    vi.useFakeTimers();
    const provider = createMockProvider();
    const wallet = walletFor(provider, { providerReadTimeoutMs: 25 });
    await wallet.ready();
    const state = wallet.state;
    const late = deferred<unknown>();
    provider.setResponse("dusk_getCapabilities", () => late.promise);
    provider.request.mockClear();
    const settled = vi.fn();
    const pending = Promise.allSettled([wallet.refresh(), wallet.refresh()]).then(settled);
    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toHaveBeenCalledWith([
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ name: "DuskWalletRequestTimeoutError" }) }),
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ name: "DuskWalletRequestTimeoutError" }) }),
    ]);
    await pending;
    expect(provider.request).toHaveBeenCalledTimes(3);
    if (completion === "resolve") late.resolve({ chainId: "dusk:3", nodeUrl: "https://late.example" });
    else late.reject(new Error("Late provider failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(wallet.state).toEqual(state);
    provider.setResponse("dusk_getCapabilities", undefined);
    await wallet.refresh();
    expect(wallet.state.node?.nodeUrl).toBe("https://testnet.nodes.dusk.network");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["getCapabilities", "getChainId", "getProfiles", "getPublicBalance", "getGasPrice"] as const)("bounds the public %s helper too", async (helper) => {
    vi.useFakeTimers();
    const provider = createMockProvider();
    const wallet = walletFor(provider, { autoRefresh: false, providerReadTimeoutMs: 25 });
    await wallet.ready();
    provider.request.mockImplementation(() => ({ then() {} }));
    const settled = vi.fn();
    wallet[helper]().then(() => settled("success"), settled);
    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: "DuskWalletRequestTimeoutError" }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "dusk_requestProfiles", "dusk_requestShieldedAddress", "dusk_switchNetwork", "dusk_sendTransaction",
    "dusk_signMessage", "dusk_signAuth", "dusk_signTypedData", "dusk_watchAsset",
  ])("does not apply the read deadline to %s approvals", async (method) => {
    vi.useFakeTimers();
    const late = deferred<unknown>();
    const provider = createMockProvider({ responses: { [method]: () => late.promise } });
    const wallet = walletFor(provider, { autoRefresh: false, providerReadTimeoutMs: 25 });
    await wallet.ready();
    const settled = vi.fn();
    const pending = wallet.request(method).then(settled, settled);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    late.resolve({ accepted: true });
    await pending;
    expect(settled).toHaveBeenCalledWith({ accepted: true });
  });

  it.each(["throw", "reject"])("cleans up the timer after a provider %s and preserves error translation", async (failure) => {
    vi.useFakeTimers();
    const provider = createMockProvider();
    const wallet = walletFor(provider, { autoRefresh: false, providerReadTimeoutMs: 25 });
    await wallet.ready();
    provider.request.mockImplementation(() => {
      const error = Object.assign(new Error("Unsupported"), { code: 4200 });
      if (failure === "throw") throw error;
      return Promise.reject(error);
    });
    await expect(wallet.getCapabilities()).rejects.toMatchObject({ name: "DuskWalletUnsupportedMethodError", code: 4200 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 0.5, NaN, Infinity, 2 ** 31, "25", null])("rejects an invalid read timeout: %j", (providerReadTimeoutMs) => {
    expect(() => createDuskWallet({ providerReadTimeoutMs: providerReadTimeoutMs as number })).toThrow(TypeError);
  });
});
