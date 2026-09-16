// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createDuskContract } from "./contract.js";
import { ensureChain } from "./ensureChain.js";
import { DuskWalletProviderChangedError, DuskWalletProviderSelectionError } from "./errors.js";
import { DUSK_SELECTED_PROVIDER_STORAGE_KEY, makeDuskAnnounceProviderEvent, requestDuskProviders } from "./discovery.js";
import { createMockProvider, createMockProviderInfo } from "./test/mocks.js";
import { installReferenceWallet } from "./test/referenceWallet.js";
import { createDuskWallet } from "./wallet.js";

describe("integration: multi-provider wallet selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it.each([42, { arbitrary: true }, ["dusk:3"], null])("clears the previous provider's chain before hydrating a replacement: %j", async chainId => {
    const unsupported = () => { throw Object.assign(new Error("Unsupported"), { code: 4200 }); };
    const first = createMockProvider({ chainId: "dusk:2" });
    const next = createMockProvider({ responses: {
      dusk_getCapabilities: unsupported, dusk_chainId: unsupported, dusk_switchNetwork: null,
    } });
    Object.defineProperty(next, "chainId", { get: () => chainId });
    const info = createMockProviderInfo({ uuid: "next", rdns: "example.next" });
    const wallet = createDuskWallet({ provider: first });
    onTestFinished(() => wallet.destroy());
    await wallet.ready();
    expect(wallet.state.chainId).toBe("dusk:2");
    const epoch = wallet.selectionEpoch;
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: next }));
    const selecting = wallet.selectProvider(info.uuid);
    const immediate = wallet.state;
    await selecting;
    expect(wallet.provider).toBe(next);
    expect(wallet.selectionEpoch).toBe(epoch + 1);
    expect(immediate.chainId).toBeNull();
    expect(wallet.state.chainId).toBeNull();
    expect(wallet.state.node).toBeNull();
    await expect(ensureChain(wallet, { chainId: "dusk:2" })).resolves.toBe(true);
    expect(next.request).toHaveBeenLastCalledWith({ method: "dusk_switchNetwork", params: [{ chainId: "dusk:2" }] });

    // Once B supplies a valid chain, malformed B updates may retain B's snapshot, never A's.
    next.setResponse("dusk_chainId", "dusk:3");
    await wallet.refresh();
    expect(wallet.state.chainId).toBe("dusk:3");
    next.setResponse("dusk_chainId", unsupported);
    await wallet.refresh();
    expect(wallet.state.chainId).toBe(chainId === null ? null : "dusk:3"); // Explicit null still clears.
  });

  it.each(["write", "ensureChain"])("reports current selection errors after failed startup during %s", async operation => {
    vi.useFakeTimers();
    const provider = createMockProvider({ responses: { dusk_getCapabilities: { then() {} } } });
    const info = createMockProviderInfo();
    const wallet = createDuskWallet({ provider, providerInfo: info, providerReadTimeoutMs: 25 });
    try {
      const startup = wallet.ready().catch(error => error);
      await vi.advanceTimersByTimeAsync(25);
      const error = await startup;
      expect(error).toMatchObject({ name: "DuskWalletRequestTimeoutError" });
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: createMockProvider() }));
      expect(wallet.provider).toBeNull();
      expect(wallet.providers[0]?.conflicted).toBe(true);
      const encodeInputFn = vi.fn(() => new Uint8Array());
      const contract = createDuskContract({
        contractId: "0x" + "11".repeat(32), wallet, driver: { encodeInputFn } as any,
      });
      const request = operation === "write"
        ? contract.write["ping"]!(undefined, { privacy: "public" })
        : ensureChain(wallet, { chainId: "dusk:2" });
      await expect(request).rejects.toBeInstanceOf(DuskWalletProviderSelectionError);
      expect(encodeInputFn).not.toHaveBeenCalled();
      expect(provider.request.mock.calls.some(([arg]) => arg.method === "dusk_sendTransaction" || arg.method === "dusk_switchNetwork")).toBe(false);
      await expect(wallet.ready()).rejects.toBe(error);
      expect(vi.getTimerCount()).toBe(0);
    } finally { wallet.destroy(); vi.useRealTimers(); }
  });

  it("keeps the shared registry helper off the public package root", async () => {
    const root = await import("./index.js");
    expect(root.requestDuskProviders).toBe(requestDuskProviders);
    expect(root).not.toHaveProperty("registerDiscoveredProvider");
  });

  it("quarantines a UUID collision instead of replacing the selected provider", async () => {
    const selected = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Selected Wallet",
        rdns: "com.example.wallet",
      },
      accounts: ["dusk1selected111111111111111111111111111111111111111"],
      announceOnStart: false,
    });
    const wallet = createDuskWallet();
    let collision: ReturnType<typeof installReferenceWallet> | undefined;
    let healthy: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      expect(wallet.provider).toBe(selected.provider);
      selected.info.name = "Updated Selected Wallet";
      selected.info.conflicted = true; // Announcements cannot supply SDK conflict state.
      selected.announce();
      expect(wallet.providerInfo?.name).toBe("Updated Selected Wallet");
      expect(wallet.providerInfo?.conflicted).toBeUndefined();
      collision = installReferenceWallet({
        info: { uuid: "com.example.wallet", name: "Colliding Wallet", rdns: "com.example.collision" },
        accounts: ["dusk1collision1111111111111111111111111111111111111"], announceOnStart: false,
      });
      collision.announce();
      expect(wallet.provider).toBeNull();
      expect(wallet.providers).toMatchObject([{ uuid: selected.info.uuid, conflicted: true }]);
      wallet.providers[0]!.conflicted = false; // Returned state is a copy.
      await expect(wallet.selectProvider(selected.info.uuid)).rejects.toBeInstanceOf(DuskWalletProviderSelectionError);
      selected.info.conflicted = false;
      selected.announce();
      expect(wallet.provider).toBeNull();
      expect(wallet.providers[0]?.conflicted).toBe(true);
      healthy = installReferenceWallet({ info: { uuid: "healthy", rdns: "com.example.healthy" } });
      expect(wallet.provider).toBeNull(); // No automatic replacement after a collision.
      await wallet.selectProvider(healthy.info.uuid);
      expect(wallet.provider).toBe(healthy.provider);
      selected.provider.setAuthorized(true);
      selected.provider.setAccounts(["late-old-account"]);
      expect(wallet.state.accounts).toEqual([]);
    } finally { wallet.destroy(); selected.cleanup(); collision?.cleanup(); healthy?.cleanup(); }
  });

  it.each([false, true])("reports the same conflict from the collector regardless of order (%s)", async reverse => {
    const fixtures = (reverse ? ["Two", "One"] : ["One", "Two"]).map(name => installReferenceWallet({
      info: { uuid: "same-id", name, rdns: "com.example.wallet" }, announceOnStart: false,
    }));
    const collection = requestDuskProviders({ timeoutMs: 0 });
    fixtures.forEach(fixture => fixture.announce());
    try {
      const found = await collection;
      expect(found).toHaveLength(1);
      expect(found[0]?.provider).toBe(fixtures[0]!.provider);
      expect(found[0]?.info.conflicted).toBe(true);
      // Repeated metadata from the first object must not remove the conflict.
      const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false, preferredProviderId: "same-id" });
      try {
        await wallet.ready();
        expect(wallet.provider).toBeNull();
        expect(wallet.providers[0]?.conflicted).toBe(true);
      } finally { wallet.destroy(); }
    } finally { fixtures.forEach(fixture => fixture.cleanup()); }
  });

  it("invalidates a pending read when its selected UUID becomes conflicted", async () => {
    let complete!: (value: string) => void;
    const pending = new Promise<string>(resolve => { complete = resolve; });
    const selected = installReferenceWallet({ info: { uuid: "same-id" }, announceOnStart: false,
      requestOverrides: { dusk_chainId: () => pending } });
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    let collision: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      const read = wallet.getChainId();
      const refused = expect(read).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
      collision = installReferenceWallet({ info: { uuid: "same-id" }, announceOnStart: false });
      collision.announce();
      complete("dusk:2");
      await refused;
      expect(wallet.provider).toBeNull();
    } finally { wallet.destroy(); selected.cleanup(); collision?.cleanup(); }
  });

  it.each([
    ["Q,P", true],
    ["P,Q", true],
    ["P,R,Q", true],
    ["P,R", false], // A conflict Q has not joined must not disable explicit Q.
  ] as const)("handles metadata-less explicit selection after announcements %s", async (order, quarantine) => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    let finish!: (value: string) => void;
    const response = new Promise<string>(resolve => { finish = resolve; });
    const fixtures = {
      Q: installReferenceWallet({ info: { uuid, name: "Q" }, announceOnStart: false,
        requestOverrides: { dusk_chainId: () => response } }),
      P: installReferenceWallet({ info: { uuid, name: "P" }, announceOnStart: false }),
      R: installReferenceWallet({ info: { uuid, name: "R" }, announceOnStart: false }),
    };
    // Remove automatic request listeners; announce manually after initialization.
    Object.values(fixtures).forEach(fixture => fixture.cleanup());
    const requests = vi.spyOn(fixtures.Q.provider, "request");
    const wallet = createDuskWallet({ provider: fixtures.Q.provider, autoRefresh: false, waitForProvider: false });
    try {
      await wallet.ready();
      expect(wallet.providers).toEqual([]);
      expect(wallet.provider).toBe(fixtures.Q.provider);
      expect(requests).not.toHaveBeenCalled();
      const epoch = wallet.selectionEpoch;
      const read = wallet.getChainId().catch(error => error);
      expect(requests).toHaveBeenCalledTimes(1);
      for (const name of order.split(",") as Array<keyof typeof fixtures>) fixtures[name].announce();
      expect(wallet.providers).toMatchObject([{ uuid, conflicted: true }]);
      finish("dusk:2");
      const outcome = await read;
      const next = await wallet.getChainId().catch(error => error);
      expect({
        selected: wallet.provider === fixtures.Q.provider,
        epochDelta: wallet.selectionEpoch - epoch,
        pending: outcome instanceof DuskWalletProviderChangedError ? "changed" : outcome,
        next: next instanceof DuskWalletProviderSelectionError ? "selection-required" : next,
        rpcCalls: requests.mock.calls.length,
      }).toEqual(quarantine
        ? { selected: false, epochDelta: 1, pending: "changed", next: "selection-required", rpcCalls: 1 }
        : { selected: true, epochDelta: 0, pending: "dusk:2", next: "dusk:2", rpcCalls: 2 });
    } finally {
      finish("dusk:2");
      wallet.destroy();
      Object.values(fixtures).forEach(fixture => fixture.cleanup());
    }
  });

  it.each([
    ["Q,P", false],
    ["P,Q", false],
    ["P,R,Q", false],
    ["Q,P", true],
    ["P,Q", true],
  ] as const)("refuses an explicit startup conflict %s (providerInfo=%s)", async (order, withInfo) => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const fixtures = order.split(",").map(name => installReferenceWallet({
      info: { uuid, name }, announceOnStart: false,
    }));
    const selected = fixtures.find(fixture => fixture.info.name === "Q")!;
    const requests = vi.spyOn(selected.provider, "request");
    const wallet = createDuskWallet({ provider: selected.provider,
      ...(withInfo ? { providerInfo: selected.info } : {}), autoRefresh: false, waitForProvider: false });
    try {
      // Request listeners announce synchronously before construction returns.
      expect(wallet.providers).toMatchObject([{ uuid, conflicted: true }]);
      await wallet.ready();
      const next = await wallet.getChainId().catch(error => error);
      expect(wallet.provider).toBeNull();
      expect(next).toBeInstanceOf(DuskWalletProviderSelectionError);
      expect(requests).not.toHaveBeenCalled();
    } finally {
      wallet.destroy();
      fixtures.forEach(fixture => fixture.cleanup());
    }
  });

  it("persists a product hint and restores its new session UUID only when unambiguous", async () => {
    const first = installReferenceWallet({ info: { uuid: "session-one", rdns: "com.example.product" } });
    const initial = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    try {
      await initial.ready();
      await initial.selectProvider(first.info.uuid);
      expect(JSON.parse(localStorage.getItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY)!)).toEqual({ version: 1, rdns: "com.example.product" });
    } finally { initial.destroy(); first.cleanup(); }

    const next = installReferenceWallet({ info: { uuid: "session-two", rdns: "com.example.product" } });
    const other = installReferenceWallet({ info: { uuid: "other", rdns: "com.example.other" } });
    const restored = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    let duplicateProduct: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await restored.ready();
      expect(restored.provider).toBe(next.provider);
      duplicateProduct = installReferenceWallet({ info: { uuid: "session-three", rdns: "com.example.product" } });
      expect(restored.provider).toBeNull(); // A late match invalidates automatic restoration.
      await restored.selectProvider(next.info.uuid); // Explicit instance choice is still possible.
      duplicateProduct.info.name = "Updated product metadata";
      duplicateProduct.announce();
      expect(restored.provider).toBe(next.provider);
      const ambiguous = createDuskWallet({ autoRefresh: false, waitForProvider: false });
      try { await ambiguous.ready(); expect(ambiguous.provider).toBeNull(); }
      finally { ambiguous.destroy(); }
    } finally { restored.destroy(); next.cleanup(); other.cleanup(); duplicateProduct?.cleanup(); }
  });

  it("gives reference provider instances fresh UUIDv4 values", () => {
    const one = installReferenceWallet();
    const two = installReferenceWallet();
    try {
      expect(one.info.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(two.info.uuid).not.toBe(one.info.uuid);
      expect(two.info.rdns).toBe(one.info.rdns);
    } finally { one.cleanup(); two.cleanup(); }
  });

  it("keeps discovery usable when browser storage access throws", async () => {
    const fixture = installReferenceWallet();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    let wallet: ReturnType<typeof createDuskWallet> | undefined;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("storage disabled"); } });
    try {
      wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
      await wallet.ready();
      await wallet.selectProvider(fixture.info.uuid);
      expect(wallet.provider).toBe(fixture.provider);
    } finally { wallet?.destroy(); fixture.cleanup(); Object.defineProperty(globalThis, "localStorage", descriptor); }
  });

  it("preserves legacy/current-page ID preferences and persistence opt-out", async () => {
    const one = installReferenceWallet({ info: { uuid: "one" } });
    const two = installReferenceWallet({ info: { uuid: "two" } });
    localStorage.setItem("custom-key", "two");
    const legacy = createDuskWallet({ autoRefresh: false, waitForProvider: false, providerStorageKey: "custom-key" });
    const explicit = createDuskWallet({ autoRefresh: false, waitForProvider: false, preferredProviderId: "one", providerStorageKey: "custom-key" });
    const disabled = createDuskWallet({ autoRefresh: false, waitForProvider: false, providerStorageKey: "custom-key", rememberLastUsedProvider: false });
    try {
      await Promise.all([legacy.ready(), explicit.ready(), disabled.ready()]);
      expect(legacy.provider).toBe(two.provider);
      expect(explicit.provider).toBe(one.provider);
      expect(disabled.provider).toBeNull();
      await disabled.selectProvider("one");
      expect(localStorage.getItem("custom-key")).toBe("two");
    } finally { legacy.destroy(); explicit.destroy(); disabled.destroy(); one.cleanup(); two.cleanup(); }
  });

  it.each([true, false])("ignores explicit metadata conflict flags (%s), not actual collisions", async conflicted => {
    const first = installReferenceWallet({ info: { uuid: "explicit" }, announceOnStart: false });
    const wallet = createDuskWallet({ provider: first.provider, providerInfo: { ...first.info, conflicted }, autoRefresh: false });
    let collision: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      expect(wallet.provider).toBe(first.provider);
      expect(wallet.providers[0]?.conflicted).toBeUndefined();
      collision = installReferenceWallet({ info: { uuid: first.info.uuid }, announceOnStart: false });
      collision.announce();
      expect(wallet.provider).toBeNull();
      expect(wallet.providers[0]?.conflicted).toBe(true);
      await expect(wallet.selectProvider(first.info.uuid)).rejects.toBeInstanceOf(DuskWalletProviderSelectionError);
      first.announce();
      expect(wallet.providers[0]?.conflicted).toBe(true);
    } finally { wallet.destroy(); first.cleanup(); collision?.cleanup(); }
  });

  it.each([
    ["legacy", "preferred", undefined],
    ["product", JSON.stringify({ version: 1, rdns: "com.example.preferred" }), undefined],
    ["current-page", undefined, "preferred"],
  ] as const)("does not substitute a lone provider for an unmatched %s preference", async (_name, stored, preferredProviderId) => {
    if (stored) localStorage.setItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY, stored);
    const other = installReferenceWallet({ info: { uuid: "other", rdns: "com.example.other" }, announceOnStart: false });
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false, preferredProviderId: preferredProviderId ?? null });
    let preferred: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      expect(wallet.providers).toHaveLength(1);
      await expect(wallet.getChainId()).rejects.toBeInstanceOf(DuskWalletProviderSelectionError);
      expect(wallet.provider).toBeNull();
      preferred = installReferenceWallet({ info: { uuid: "preferred", rdns: "com.example.preferred" }, announceOnStart: false });
      preferred.announce();
      expect(wallet.provider).toBe(preferred.provider);
      await expect(wallet.getChainId()).resolves.toBe("dusk:2");
      await wallet.selectProvider(other.info.uuid);
      expect(wallet.provider).toBe(other.provider);
    } finally { wallet.destroy(); other.cleanup(); preferred?.cleanup(); }
  });

  it.each(["{legacy-wallet}", '{"legacy":"wallet"}', '{"version":1,"rdns":""}'])(
    "preserves the legacy raw-ID preference %s", async uuid => {
      localStorage.setItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY, uuid);
      const legacy = installReferenceWallet({ info: { uuid }, announceOnStart: false });
      const other = installReferenceWallet({ info: { uuid: "other" }, announceOnStart: false });
      const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
      try {
        await wallet.ready();
        expect(wallet.providers).toHaveLength(2); // A lone-provider fallback must not mask a dropped preference.
        expect(wallet.provider).toBe(legacy.provider);
      } finally { wallet.destroy(); legacy.cleanup(); other.cleanup(); }
    },
  );

  it("does not apply stored-product ambiguity to an explicit constructor selection", async () => {
    localStorage.setItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY, JSON.stringify({ version: 1, rdns: "com.example.product" }));
    const first = installReferenceWallet({ info: { uuid: "explicit", rdns: "com.example.product" }, announceOnStart: false });
    const wallet = createDuskWallet({ provider: first.provider, providerInfo: first.info, autoRefresh: false });
    let other: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      expect(wallet.provider).toBe(first.provider);
      other = installReferenceWallet({ info: { uuid: "other", rdns: first.info.rdns }, announceOnStart: false });
      other.announce();
      expect(wallet.providers).toHaveLength(2);
      expect(wallet.providers.every(info => !info.conflicted)).toBe(true);
      expect(wallet.provider).toBe(first.provider);
    } finally { wallet.destroy(); first.cleanup(); other?.cleanup(); }
  });

  it("keeps provider selection deterministic when multiple wallets coexist", async () => {
    const primary = installReferenceWallet({
      info: {
        uuid: "com.example.alpha",
        name: "Alpha Wallet",
        rdns: "com.example.alpha",
      },
      accounts: ["dusk1alphawalletaccount11111111111111111111111111111"],
      chainId: "dusk:2",
      announceOnStart: false,
    });
    const secondary = installReferenceWallet({
      info: {
        uuid: "com.example.beta",
        name: "Beta Wallet",
        rdns: "com.example.beta",
      },
      accounts: ["dusk1betawalletaccount111111111111111111111111111111"],
      chainId: "dusk:3",
      announceOnStart: false,
    });

    const ambiguousWallet = createDuskWallet();
    await ambiguousWallet.ready();

    expect(ambiguousWallet.state.availableProviders.map((item) => item.uuid)).toEqual([
      "com.example.alpha",
      "com.example.beta",
    ]);
    expect(ambiguousWallet.state.providerId).toBeNull();
    await expect(ambiguousWallet.connect()).rejects.toBeInstanceOf(
      DuskWalletProviderSelectionError
    );
    ambiguousWallet.destroy();

    const wallet = createDuskWallet({
      preferredProviderId: "com.example.beta",
    });
    await wallet.ready();

    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual([
      "com.example.alpha",
      "com.example.beta",
    ]);
    expect(wallet.state.providerId).toBe("com.example.beta");
    expect(wallet.state.providerInfo?.name).toBe("Beta Wallet");

    await expect(wallet.connect()).resolves.toEqual([
      {
        profileId: "profile:0",
        account: "dusk1betawalletaccount111111111111111111111111111111",
      },
    ]);

    primary.provider.emit("profilesChanged", [
      {
        profileId: "profile:0",
        account: "dusk1alphachangedwallet111111111111111111111111111111",
      },
    ]);
    primary.provider.emit("chainChanged", "dusk:1");

    expect(wallet.state.providerId).toBe("com.example.beta");
    expect(wallet.state.accounts).toEqual([
      "dusk1betawalletaccount111111111111111111111111111111",
    ]);
    expect(wallet.state.chainId).toBe("dusk:3");

    secondary.provider.setAccounts([
      "dusk1betachangedwallet111111111111111111111111111111",
    ]);

    expect(wallet.state.accounts).toEqual([
      "dusk1betachangedwallet111111111111111111111111111111",
    ]);
    expect(wallet.state.selectedAddress).toBe(
      "dusk1betachangedwallet111111111111111111111111111111"
    );

    wallet.destroy();
    primary.cleanup();
    secondary.cleanup();
  });
});
