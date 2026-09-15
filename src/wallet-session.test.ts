// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDuskWallet } from "./wallet.js";
import { createMockProvider } from "./test/mocks.js";
import { ERROR_CODES } from "./errors.js";
import type { ConnectOptions, DuskProfile } from "./types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("same-provider session and network changes", () => {
  it.each(["connect", "getProfiles", "refresh"] as const)(
    "%s must not restore profiles after completed disconnect",
    async (method) => {
      const provider = createMockProvider({ authorized: true });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      const snapshot = wallet.state.profiles;
      let release!: (profiles: DuskProfile[]) => void;
      const delayed = new Promise<DuskProfile[]>((resolve) => { release = resolve; });
      provider.setResponse(method === "connect" ? "dusk_requestProfiles" : "dusk_profiles", () => delayed);
      const pending = wallet[method]().catch(error => error);
      try {
        await wallet.disconnect();
        expect(wallet.state.accounts).toEqual([]);
        expect(provider.isAuthorized).toBe(false);
        release(snapshot);
        expect(await pending).toMatchObject({ name: "DuskSdkError", data: { reason: "session_changed" } });
        expect(wallet.state).toMatchObject({ authorized: false, accounts: [], profiles: [] });
      } finally {
        release(snapshot);
        await pending;
        wallet.destroy();
      }
    }
  );

  it.each(["getProfiles", "connect"] as const)("an old disconnect response does not invalidate a newer %s", async (method) => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let releaseDisconnect!: (value: boolean) => void;
    provider.setResponse("dusk_disconnect", () => {
      provider.setAuthorized(false);
      return new Promise<boolean>(resolve => { releaseDisconnect = resolve; });
    });
    const disconnect = wallet.disconnect();
    let releaseProfiles: (value: DuskProfile[]) => void = () => {};
    try {
      if (method === "getProfiles") {
        provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { releaseProfiles = resolve; }));
      }
      const fresh = wallet[method]();
      // Attach the expectation before delivering either late response.
      const expectation = expect(fresh).resolves.toBeInstanceOf(Array);
      if (method === "connect") await fresh;
      releaseDisconnect(true);
      await disconnect;
      releaseProfiles([]);
      await expectation;
      expect(wallet.state.authorized).toBe(method === "connect");
    } finally { releaseDisconnect(true); releaseProfiles([]); await disconnect; wallet.destroy(); }
  });

  it("discards older reads on a failed disconnect intent without claiming permission was revoked", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const snapshot = wallet.state.profiles;
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    provider.setResponse("dusk_disconnect", () => { throw new Error("Offline"); });
    const pending = wallet.getProfiles();
    const rejected = expect(pending).rejects.toThrow("session changed");
    try {
      await expect(wallet.disconnect()).rejects.toThrow("Offline");
      release(snapshot);
      await rejected;
      expect(wallet.state.authorized).toBe(true);
      provider.setResponse("dusk_profiles", undefined);
      await expect(wallet.getProfiles()).resolves.toEqual(snapshot);
    } finally { release(snapshot); await pending.catch(() => {}); wallet.destroy(); }
  });

  it("a disconnect event invalidates a pending first connection even if state was already empty", async () => {
    const provider = createMockProvider();
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_requestProfiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    const pending = wallet.connect();
    const expectation = expect(pending).rejects.toThrow("session changed");
    try {
      provider.emit("disconnect", { code: 4900, message: "Disconnected" });
      release([{ profileId: "profile:0", account: "old-account" }]);
      await expectation;
      expect(wallet.state).toMatchObject({ authorized: false, profiles: [] });
    } finally { release([]); await pending.catch(() => {}); wallet.destroy(); }
  });

  it("keeps profiles cleared when a provider locks without revoking permission", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const snapshot = wallet.state.profiles;
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    const pending = wallet.getProfiles().catch(() => undefined);
    try {
      provider.setProfiles([]);
      release(snapshot);
      await pending;
      expect(wallet.state).toMatchObject({ authorized: true, profiles: [], accounts: [] });
      provider.setAccounts(["new-account"]);
      expect(wallet.state.accounts).toEqual(["new-account"]);
    } finally { release(snapshot); await pending; wallet.destroy(); }
  });

  it("does not restore a shielded profile after disconnect, and keeps later events working", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const response = { address: "disposable-test-address", account: wallet.state.accounts[0], profileId: "profile:0" };
    let release!: (address: typeof response) => void;
    provider.setResponse("dusk_requestShieldedAddress", () => new Promise<typeof response>(resolve => { release = resolve; }));
    const pending = wallet.requestShieldedAddress().catch(() => undefined);
    try {
      await wallet.disconnect();
      release(response);
      await pending;
      expect(wallet.state).toMatchObject({ authorized: false, profiles: [] });
      await wallet.connect();
      provider.setAccounts(["new-account"]);
      provider.setChainId("dusk:3");
      expect(wallet.state).toMatchObject({ authorized: true, accounts: ["new-account"], chainId: "dusk:3" });
    } finally { release(response); await pending; wallet.destroy(); }
  });

  it("refresh must not undo a newer chain/node change from the same provider", async () => {
    const provider = createMockProvider({ authorized: true, chainId: "dusk:2" });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let release!: (chain: string) => void;
    provider.setResponse("dusk_chainId", () => new Promise<string>((resolve) => { release = resolve; }));
    const pending = wallet.refresh().catch(error => error);
    try {
      provider.setChainId("dusk:3");
      provider.emit("duskNodeChanged", { chainId: "dusk:3", nodeUrl: "https://nodes.dusk.network", networkName: "Mainnet" });
      expect(wallet.state.chainId).toBe("dusk:3");
      release("dusk:2");
      expect(await pending).toMatchObject({ name: "DuskSdkError", data: { reason: "network_changed" } });
      expect(wallet.state).toMatchObject({
        chainId: "dusk:3",
        node: { nodeUrl: "https://nodes.dusk.network" },
      });
    } finally {
      release("dusk:2");
      await pending;
      wallet.destroy();
    }
  });

  it.each(["connect", "requestProfiles"] as const)("allows overlapping %s calls in an unchanged session", async (method) => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const profiles = wallet.state.profiles;
    try {
      await expect(Promise.all([wallet[method](), wallet[method]()])).resolves.toEqual([profiles, profiles]);
      expect(wallet.state).toMatchObject({ authorized: true, profiles });
    } finally { wallet.destroy(); }
  });

  it("keeps an earlier connection valid when a later disclosure is denied", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const profiles = wallet.state.profiles;
    const delayed = deferred<DuskProfile[]>();
    provider.setResponse("dusk_requestProfiles", (params: unknown) => {
      if ((params as ConnectOptions | undefined)?.shieldedReceiveAddress) {
        throw Object.assign(new Error("Disclosure denied"), { code: ERROR_CODES.USER_REJECTED });
      }
      return delayed.promise;
    });
    const pending = Promise.allSettled([wallet.connect()]);
    try {
      await expect(wallet.connect({ shieldedReceiveAddress: true })).rejects.toMatchObject({
        name: "DuskWalletUserRejectedError", code: ERROR_CODES.USER_REJECTED,
      });
      expect(provider.isAuthorized).toBe(true);
      expect(provider.profiles).toEqual(profiles);
      delayed.resolve(profiles);
      expect(await pending).toEqual([{ status: "fulfilled", value: profiles }]);
      expect(wallet.state).toMatchObject({ authorized: true, profiles });
    } finally { delayed.resolve(profiles); await pending; wallet.destroy(); }
  });

  it.each(["getProfiles", "refresh", "requestShieldedAddress"] as const)(
    "keeps a pending %s valid across an unchanged connection",
    async (method) => {
      const provider = createMockProvider({ authorized: true });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      const profiles = wallet.state.profiles;
      const response = method === "requestShieldedAddress"
        ? { address: "shielded-receive-address", account: profiles[0]!.account, profileId: profiles[0]!.profileId }
        : profiles;
      const delayed = deferred<typeof response>();
      provider.setResponse(method === "requestShieldedAddress" ? "dusk_requestShieldedAddress" : "dusk_profiles", () => delayed.promise);
      const pending = Promise.allSettled([wallet[method]()]);
      try {
        await wallet.connect();
        delayed.resolve(response);
        const value = method === "requestShieldedAddress" ? "shielded-receive-address"
          : method === "refresh" ? expect.objectContaining({ authorized: true, profiles }) : profiles;
        expect(await pending).toEqual([{ status: "fulfilled", value }]);
      } finally { delayed.resolve(response); await pending; wallet.destroy(); }
    }
  );

  it.each([false, true])("coalesces initial refreshes with autoRefresh=%s without caching settled results", async (autoRefresh) => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh });
    if (!autoRefresh) await wallet.ready();
    expect(wallet.state.node).toBeNull();
    const epoch = wallet.networkEpoch;
    try {
      const states = await Promise.all([wallet.refresh(), wallet.refresh()]);
      const expected = {
        authorized: true, profiles: provider.profiles, chainId: "dusk:2",
        node: { nodeUrl: "https://testnet.nodes.dusk.network" },
      };
      expect(states).toMatchObject([expected, expected]);
      expect(states[0]).not.toBe(states[1]);
      states[0]!.profiles[0]!.account = "modified-copy";
      expect(states[1]!.profiles).toEqual(provider.profiles);
      expect(wallet.state.profiles).toEqual(provider.profiles);
      expect(wallet.networkEpoch).toBe(epoch + 1);
      expect(provider.request).toHaveBeenCalledTimes(3);
      await wallet.ready();
      await wallet.refresh();
      await wallet.refresh();
      expect(provider.request).toHaveBeenCalledTimes(9);
    } finally { await wallet.ready(); wallet.destroy(); }
  });

  it.each(["disconnect", "lock", "chain", "node"] as const)(
    "starts a fresh refresh after %s and retains it when the old refresh settles",
    async (change) => {
      const provider = createMockProvider({ authorized: true });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      const old = deferred<string>();
      const fresh = deferred<string>();
      let next = old.promise;
      let chainReads = 0;
      provider.setResponse("dusk_chainId", () => { chainReads++; return next; });
      const stale = Promise.allSettled([wallet.refresh(), wallet.refresh()]);
      let current: Promise<unknown> | undefined;
      try {
        if (change === "disconnect") await wallet.disconnect();
        if (change === "lock") provider.setProfiles([]);
        if (change === "chain") provider.setChainId("dusk:3");
        const nodeUrl = change === "node" ? "https://new-node.example" : "https://testnet.nodes.dusk.network";
        if (change === "node") provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl, networkName: "New node" });
        provider.setResponse("dusk_getCapabilities", { chainId: provider.chainId, nodeUrl });
        next = fresh.promise;
        const first = wallet.refresh();
        current = Promise.allSettled([first]);
        old.resolve("dusk:2");
        const reason = change === "disconnect" || change === "lock" ? "session_changed" : "network_changed";
        expect(await stale).toMatchObject([
          { status: "rejected", reason: { name: "DuskSdkError", data: { reason } } },
          { status: "rejected", reason: { name: "DuskSdkError", data: { reason } } },
        ]);
        current = Promise.allSettled([first, wallet.refresh()]);
        expect(chainReads).toBe(2);
        fresh.resolve(provider.chainId!);
        const expected = {
          authorized: provider.isAuthorized, profiles: provider.profiles,
          chainId: provider.chainId, node: { nodeUrl },
        };
        expect(await current).toMatchObject([
          { status: "fulfilled", value: expected }, { status: "fulfilled", value: expected },
        ]);
        expect(wallet.state).toMatchObject(expected);
      } finally {
        old.resolve("dusk:2"); fresh.resolve(provider.chainId!);
        await stale; await current; wallet.destroy();
      }
    }
  );

  it("coalesces a refresh reentered synchronously through a provider event", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const caps = await wallet.getCapabilities();
    provider.request.mockClear();
    let joined!: ReturnType<typeof wallet.refresh>;
    wallet.on("chainChanged", () => { joined = wallet.refresh(); });
    provider.setResponse("dusk_getCapabilities", () => {
      provider.setResponse("dusk_getCapabilities", caps);
      provider.emit("chainChanged", provider.chainId!);
      return caps;
    });
    try {
      const first = wallet.refresh();
      const states = await Promise.all([first, joined]);
      expect(states).toEqual([wallet.state, wallet.state]);
      expect(wallet.state.node?.nodeUrl).toBe(caps.nodeUrl);
      expect(provider.request).toHaveBeenCalledTimes(3);
    } finally { wallet.destroy(); }
  });

  it("rechecks both refresh callers after a subscriber disconnects", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    wallet.subscribe((state) => {
      if (state.authorized && state.node) {
        provider.setAuthorized(false);
        provider.emit("disconnect", { code: ERROR_CODES.DISCONNECTED, message: "Disconnected" });
      }
    });
    try {
      expect(await Promise.allSettled([wallet.refresh(), wallet.refresh()])).toMatchObject([
        { status: "rejected", reason: { name: "DuskSdkError", data: { reason: "session_changed" } } },
        { status: "rejected", reason: { name: "DuskSdkError", data: { reason: "session_changed" } } },
      ]);
      expect(wallet.state).toMatchObject({ authorized: false, profiles: [], accounts: [] });
    } finally { wallet.destroy(); }
  });
});
