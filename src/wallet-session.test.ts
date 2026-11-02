// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createDuskContract } from "./contract.js";
import { createDuskWallet } from "./wallet.js";
import { createMockProvider, type MockDuskProvider } from "./test/mocks.js";
import { ERROR_CODES } from "./errors.js";
import type { ConnectOptions, DuskProfile, SendTransactionParams } from "./types.js";

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

  describe.each(["connect", "profilesChanged", "authorization"] as const)("refresh after %s", (change) => {
    it.each([false, true])("keeps the current profiles with newerFirst=%s", async (newerFirst) => {
      const provider = createMockProvider({
        authorized: change === "profilesChanged",
        accounts: change === "connect" ? ["connected-account"] : [],
      });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      await wallet.refresh(); // Keep network-cache hydration separate from the profile transition.
      const caps = wallet.state.capabilities!;
      const networkEpoch = wallet.networkEpoch;
      const selectionEpoch = wallet.selectionEpoch;
      const old = deferred<typeof caps>();
      const fresh = deferred<typeof caps>();
      let capabilityReads = 0;
      provider.setResponse("dusk_getCapabilities", () => ++capabilityReads === 1 ? old.promise : fresh.promise);
      provider.request.mockClear();
      const stale = Promise.allSettled([wallet.refresh()]);
      let current: ReturnType<typeof Promise.allSettled> | undefined;
      try {
        const index = provider.request.mock.calls.findIndex(([arg]) => arg.method === "dusk_profiles");
        expect(index).toBeGreaterThanOrEqual(0);
        await expect(provider.request.mock.results[index]!.value).resolves.toEqual([]);
        if (change === "connect") await wallet.connect();
        if (change === "profilesChanged") provider.setProfiles([{ profileId: "restored", account: "restored-account" }]);
        if (change === "authorization") {
          provider.setAuthorized(true);
          provider.emit("connect", { chainId: "dusk:2" });
        }
        const profiles = provider.profiles;
        expect(profiles).toHaveLength(change === "authorization" ? 0 : 1);
        const expected = {
          authorized: true, profiles, accounts: profiles.map(profile => profile.account),
          selectedProfile: profiles[0] ?? null, selectedAddress: profiles[0]?.account ?? null,
        };
        expect(wallet.state).toMatchObject(expected);
        expect(wallet.networkEpoch).toBe(networkEpoch);
        expect(wallet.selectionEpoch).toBe(selectionEpoch);
        current = Promise.allSettled([wallet.refresh()]);
        if (newerFirst) {
          // Fail instead of hanging if the newer refresh incorrectly joined the old one.
          expect(capabilityReads).toBe(2);
          fresh.resolve(caps);
          expect(await current).toMatchObject([{ status: "fulfilled", value: expected }]);
          old.resolve(caps);
        } else {
          old.resolve(caps);
          await stale;
          // The stale refresh must not erase the transition, even temporarily.
          expect(wallet.state).toMatchObject(expected);
          fresh.resolve(caps);
        }
        expect(await stale).toMatchObject([
          { status: "rejected", reason: { name: "DuskSdkError", data: { reason: "session_changed" } } },
        ]);
        expect(await current).toMatchObject([{ status: "fulfilled", value: expected }]);
        expect(wallet.state).toMatchObject(expected);
        expect(capabilityReads).toBe(2);
      } finally {
        old.resolve(caps); fresh.resolve(caps);
        await stale; await current; wallet.destroy();
      }
    });
  });

  it("allows shared refreshes to publish newly read authorization and profiles", async () => {
    const provider = createMockProvider();
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    expect(wallet.state).toMatchObject({ authorized: false, profiles: [] });
    provider.setAuthorized(true); // No event: these changes will be discovered by refresh itself.
    provider.request.mockClear();
    try {
      const states = await Promise.all([wallet.refresh(), wallet.refresh()]);
      const expected = { authorized: true, profiles: provider.profiles, accounts: ["dusk1mockaccount"] };
      expect(states).toMatchObject([expected, expected]);
      expect(wallet.state).toMatchObject(expected);
      expect(provider.request).toHaveBeenCalledTimes(3);
    } finally { wallet.destroy(); }
  });

  it("rechecks shared refresh snapshots when profiles change after publication", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let changed = false;
    wallet.subscribe(state => {
      if (state.node && !changed) {
        changed = true;
        queueMicrotask(() => provider.setAccounts(["new-account"]));
      }
    });
    try {
      expect(await Promise.allSettled([wallet.refresh(), wallet.refresh()])).toMatchObject([
        { status: "rejected", reason: { name: "DuskSdkError", data: { reason: "session_changed" } } },
        { status: "rejected", reason: { name: "DuskSdkError", data: { reason: "session_changed" } } },
      ]);
      expect(wallet.state.accounts).toEqual(["new-account"]);
    } finally { wallet.destroy(); }
  });

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

describe("sending after session or network changes", () => {
  const changes: Record<string, (provider: MockDuskProvider) => void> = {
    chain: provider => provider.setChainId("dusk:3"),
    node: provider => provider.emit("duskNodeChanged", { chainId: "dusk:2", nodeUrl: "https://other.example", networkName: "Other" }),
    lock: provider => provider.setProfiles([]),
    disconnect: provider => {
      provider.setAuthorized(false);
      provider.emit("disconnect", { code: ERROR_CODES.DISCONNECTED, message: "Disconnected" });
      provider.emit("profilesChanged", []);
    },
    profiles: provider => provider.setProfiles([{ profileId: "profile:1", account: "other-account" }]),
  };
  const sends = (provider: MockDuskProvider) =>
    provider.request.mock.calls.filter(([arg]) => arg.method === "dusk_sendTransaction");

  // Starts a write and returns once it waits on encoding.
  async function startWrite(provider: MockDuskProvider, { chain, hydrated = true }: { chain?: { chainId: string }; hydrated?: boolean } = {}) {
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    if (hydrated) await wallet.refresh(); // The write knows the wallet's node.
    const encoded = deferred<Uint8Array>();
    const encodeInputFn = vi.fn(() => encoded.promise);
    const contract = createDuskContract({
      contractId: "0x" + "11".repeat(32), wallet, driver: { encodeInputFn } as any,
      defaultTx: { privacy: "public" }, ...(chain ? { chain } : {}),
    });
    const writing = contract.write["ping"]!();
    await vi.waitFor(() => expect(encodeInputFn).toHaveBeenCalled());
    return { wallet, writing, finish: () => encoded.resolve(new Uint8Array([1])) };
  }

  async function expectSent(writing: Promise<unknown>, provider: MockDuskProvider, reason: string | null) {
    if (reason) {
      await expect(writing).rejects.toMatchObject({ name: "DuskSdkError", data: { reason } });
      expect(sends(provider)).toEqual([]);
    } else {
      await expect(writing).resolves.toMatchObject({ hash: "0xtxhash" });
      expect(sends(provider)).toEqual([[expect.objectContaining({
        params: expect.objectContaining({ kind: "contract_call", fnName: "ping", fnArgs: "0x01" }),
      })]]);
    }
  }

  it.each([
    ["nothing", null], ["chain", "network_changed"], ["node", "network_changed"],
    ["lock", "session_changed"], ["disconnect", "session_changed"], ["profiles", "session_changed"],
  ])("a contract write rechecks the wallet after encoding when %s changes", async (change, reason) => {
    const provider = createMockProvider({ authorized: true });
    const { wallet, writing, finish } = await startWrite(provider);
    try {
      changes[change]?.(provider);
      finish();
      await expectSent(writing, provider, reason);
    } finally { finish(); wallet.destroy(); }
  });

  it.each([["dusk:3", null], ["dusk:1", "network_changed"]])(
    "a write to dusk:3 checks the network the wallet reports late: %s",
    async (reported, reason) => {
      // Like the Dusk wallet, answer the switch before reporting it.
      const provider = createMockProvider({ authorized: true, responses: { dusk_switchNetwork: null } });
      const { wallet, writing, finish } = await startWrite(provider, { chain: { chainId: "dusk:3" } });
      try {
        expect(wallet.state.chainId).toBe("dusk:2");
        provider.setChainId(reported);
        finish();
        await expectSent(writing, provider, reason);
      } finally { finish(); wallet.destroy(); }
    }
  );

  it.each([["only hydrates the node", null], ["hydrates the node, then the chain switches", "network_changed"]])(
    "an auto-connect write sends when its connection %s while encoding, unless it switched",
    async (_change, reason) => {
      const caps = deferred<unknown>();
      const provider = createMockProvider({ responses: { dusk_getCapabilities: () => caps.promise } });
      const { wallet, writing, finish } = await startWrite(provider, { hydrated: false });
      try {
        expect(wallet.state).toMatchObject({ authorized: true, node: null });
        caps.resolve({ chainId: "dusk:2", nodeUrl: "https://testnet.nodes.dusk.network", networkName: "Testnet" });
        await vi.waitFor(() => expect(wallet.state.node).not.toBeNull());
        if (reason) provider.setChainId("dusk:3");
        finish();
        await expectSent(writing, provider, reason);
      } finally { caps.resolve({}); finish(); wallet.destroy(); }
    }
  );

  const node = (nodeUrl: string) => ({ chainId: "dusk:2", nodeUrl, networkName: "Custom" });
  const switches: Array<[string, { hydrated: boolean; chainless?: boolean }, (provider: MockDuskProvider) => void]> = [
    ["an unknown node to A to B", { hydrated: false }, provider => {
      provider.emit("duskNodeChanged", node("https://a.example"));
      provider.emit("duskNodeChanged", node("https://b.example"));
    }],
    ["an unknown chain to dusk:2 to dusk:3", { hydrated: false, chainless: true }, provider => {
      provider.setChainId("dusk:2");
      provider.setChainId("dusk:3");
    }],
    ["dusk:2 to dusk:3 and back", { hydrated: true }, provider => {
      provider.setChainId("dusk:3");
      provider.setChainId("dusk:2");
    }],
  ];
  it.each(switches)("a contract write refuses a switch from %s while encoding", async (_label, setup, change) => {
    const provider = createMockProvider({ authorized: true });
    if (setup.chainless) provider.setChainId(null);
    const { wallet, writing, finish } = await startWrite(provider, { hydrated: setup.hydrated });
    try {
      change(provider);
      finish();
      await expectSent(writing, provider, "network_changed");
    } finally { finish(); wallet.destroy(); }
  });

  it.each([["chain", "network_changed"], ["lock", "session_changed"]])(
    "wallet.sendTransaction sends nothing when the %s changes while it reads the call",
    async (change, reason) => {
      const provider = createMockProvider({ authorized: true });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      const params = {
        kind: "contract_call", contractId: "0x" + "11".repeat(32), fnArgs: "0x01", privacy: "public",
        get fnName() { changes[change]!(provider); return "ping"; },
      } as SendTransactionParams;
      try {
        await expect(wallet.sendTransaction(params)).rejects.toMatchObject({ name: "DuskSdkError", data: { reason } });
        expect(sends(provider)).toEqual([]);
      } finally { wallet.destroy(); }
    }
  );
});
