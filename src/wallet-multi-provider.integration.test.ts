// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createDuskContract } from "./contract.js";
import { ensureChain } from "./ensureChain.js";
import { DuskWalletProviderChangedError, DuskWalletProviderSelectionError } from "./errors.js";
import { DUSK_ANNOUNCE_PROVIDER_EVENT, DUSK_SELECTED_PROVIDER_STORAGE_KEY, makeDuskAnnounceProviderEvent, requestDuskProviders } from "./discovery.js";
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

  it.each(["write", "ensureChain"])("reports destruction instead of replaying a startup error during %s", async operation => {
    vi.useFakeTimers();
    const fixture = installReferenceWallet({ announceOnStart: false,
      requestOverrides: { dusk_getCapabilities: () => new Promise(() => {}) } });
    const { provider } = fixture;
    const requests = vi.spyOn(provider, "request");
    const wallet = createDuskWallet({ providerReadTimeoutMs: 25 });
    try {
      const startup = wallet.ready().catch(error => error);
      await vi.advanceTimersByTimeAsync(25);
      const error = await startup;
      expect(error).toMatchObject({ name: "DuskWalletRequestTimeoutError" });
      wallet.destroy();
      const encodeInputFn = vi.fn(() => new Uint8Array());
      const contract = createDuskContract({
        contractId: "0x" + "11".repeat(32), wallet, driver: { encodeInputFn } as any,
      });
      const request = operation === "write"
        ? contract.write["ping"]!(undefined, { privacy: "public" })
        : ensureChain(wallet, { chainId: "dusk:2" });
      await expect(request).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
      expect(encodeInputFn).not.toHaveBeenCalled();
      expect(requests.mock.calls.some(([arg]) => arg.method === "dusk_sendTransaction" || arg.method === "dusk_switchNetwork")).toBe(false);
      await expect(wallet.ready()).rejects.toBe(error);
      expect(vi.getTimerCount()).toBe(0);
    } finally { wallet.destroy(); fixture.cleanup(); vi.useRealTimers(); }
  });

  it("does not reserve a UUID for an invalid announcement", async () => {
    const info = createMockProviderInfo();
    const provider = createMockProvider();
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    onTestFinished(() => wallet.destroy());
    const collection = requestDuskProviders({ timeoutMs: 0 });
    window.dispatchEvent(new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, { detail: { info, provider: { ...provider, isDusk: false } } }));
    window.dispatchEvent(new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, { detail: { info: { ...info, name: "" }, provider } }));
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider }));
    const found = await collection;
    await wallet.ready();
    expect(found).toHaveLength(1);
    expect(found[0]?.provider).toBe(provider);
    expect(found[0]?.info).toEqual(info);
    expect(wallet.provider).toBe(provider);
    expect(wallet.providerInfo).toEqual(info);
  });

  it("keeps the shared registry helper off the public package root", async () => {
    const root = await import("./index.js");
    expect(root.requestDuskProviders).toBe(requestDuskProviders);
    expect(root).not.toHaveProperty("registerDiscoveredProvider");
  });

  it("ignores duplicate UUIDs and metadata without notifying, replacing or disabling the first provider", async () => {
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
      const state = wallet.state;
      const notify = vi.fn();
      wallet.subscribe(notify);
      notify.mockClear();
      selected.info.name = "Updated Selected Wallet";
      selected.info.conflicted = true; // Legacy flags and later metadata are ignored.
      selected.announce();
      expect(wallet.providerInfo?.name).toBe("Selected Wallet");
      expect(wallet.providerInfo?.conflicted).toBeUndefined();
      collision = installReferenceWallet({
        info: { uuid: "com.example.wallet", name: "Colliding Wallet", rdns: "com.example.collision" },
        accounts: ["dusk1collision1111111111111111111111111111111111111"], announceOnStart: false,
      });
      collision.announce();
      expect(wallet.provider).toBe(selected.provider);
      expect(wallet.state).toEqual(state);
      expect(notify).not.toHaveBeenCalled();
      wallet.providers[0]!.name = "Caller mutation"; // Returned state is a copy.
      wallet.providers[0]!.conflicted = true;
      expect(wallet.providers).toEqual(state.availableProviders);
      selected.cleanup(); // Rediscovery now receives the competing object first.
      await wallet.discoverProviders({ timeoutMs: 0 });
      expect(wallet.provider).toBe(selected.provider);
      expect(wallet.providers).toEqual(state.availableProviders);
      await wallet.selectProvider(selected.info.uuid);
      expect(wallet.provider).toBe(selected.provider);
      healthy = installReferenceWallet({ info: { uuid: "healthy", rdns: "com.example.healthy" } });
      expect(wallet.provider).toBe(selected.provider); // New UUIDs cannot change an active selection.
      await wallet.selectProvider(healthy.info.uuid);
      expect(wallet.provider).toBe(healthy.provider);
      selected.provider.setAuthorized(true);
      selected.provider.setAccounts(["late-old-account"]);
      expect(wallet.state.accounts).toEqual([]);
    } finally { wallet.destroy(); selected.cleanup(); collision?.cleanup(); healthy?.cleanup(); }
  });

  it("does not relabel an existing selection when its object is announced under a new UUID", async () => {
    const provider = createMockProvider();
    const info = createMockProviderInfo({ uuid: "first", name: "First" });
    const otherInfo = { ...info, uuid: "other", name: "Other" };
    const wallet = createDuskWallet({ provider, providerInfo: info, autoRefresh: false });
    onTestFinished(() => wallet.destroy());
    await wallet.ready();
    const epoch = wallet.selectionEpoch;
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: otherInfo, provider }));
    expect(wallet.providers).toEqual([info, otherInfo]);
    expect(wallet.providerInfo).toEqual(info);
    expect(wallet.state.providerId).toBe(info.uuid);
    expect(wallet.provider).toBe(provider);
    expect(wallet.selectionEpoch).toBe(epoch);
    await wallet.selectProvider(otherInfo.uuid);
    expect(wallet.providerInfo).toEqual(otherInfo); // Metadata changes only on explicit selection.
    expect(wallet.provider).toBe(provider);
  });

  it.each([false, true])("retains the first received provider and metadata for either announcement order (%s)", async reverse => {
    const fixtures = (reverse ? ["Two", "One"] : ["One", "Two"]).map(name => installReferenceWallet({
      info: { uuid: "same-id", name, rdns: "com.example.wallet" }, announceOnStart: false,
    }));
    const firstInfo = { ...fixtures[0]!.info };
    const collection = requestDuskProviders({ timeoutMs: 0 });
    fixtures[0]!.info.name = "Later metadata";
    fixtures.forEach(fixture => fixture.announce());
    try {
      const found = await collection;
      expect(found).toHaveLength(1);
      expect(found[0]?.provider).toBe(fixtures[0]!.provider);
      expect(found[0]?.info).toEqual(firstInfo);
      // Each collector has its own lifetime; the wrapper also keeps its first object.
      const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false, preferredProviderId: "same-id" });
      try {
        await wallet.ready();
        expect(wallet.provider).toBe(fixtures[0]!.provider);
        expect(wallet.providers[0]?.conflicted).toBeUndefined();
        await wallet.selectProvider("same-id");
        expect(wallet.provider).toBe(fixtures[0]!.provider);
      } finally { wallet.destroy(); }
    } finally { fixtures.forEach(fixture => fixture.cleanup()); }
  });

  it("preserves a pending automatic-selection read across duplicate UUID announcements", async () => {
    let complete!: (value: string) => void;
    const pending = new Promise<string>(resolve => { complete = resolve; });
    const selected = installReferenceWallet({ info: { uuid: "same-id" }, announceOnStart: false,
      requestOverrides: { dusk_chainId: () => pending } });
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    let collision: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      const read = wallet.getChainId();
      const kept = expect(read).resolves.toBe("dusk:2");
      collision = installReferenceWallet({ info: { uuid: "same-id" }, announceOnStart: false });
      collision.announce();
      complete("dusk:2");
      await kept;
      expect(wallet.provider).toBe(selected.provider);
    } finally { wallet.destroy(); selected.cleanup(); collision?.cleanup(); }
  });

  it.each(["Q,P", "P,Q", "P,R,Q", "P,R"])("preserves metadata-less explicit selection after late announcements %s", async order => {
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
      expect(wallet.providers).toEqual([fixtures[order[0] as keyof typeof fixtures].info]);
      finish("dusk:2");
      const outcome = await read;
      const next = await wallet.getChainId().catch(error => error);
      expect({
        selected: wallet.provider === fixtures.Q.provider,
        epochDelta: wallet.selectionEpoch - epoch,
        pending: outcome instanceof DuskWalletProviderChangedError ? "changed" : outcome,
        next: next instanceof DuskWalletProviderSelectionError ? "selection-required" : next,
        rpcCalls: requests.mock.calls.length,
      }).toEqual({ selected: true, epochDelta: 0, pending: "dusk:2", next: "dusk:2", rpcCalls: 2 });
      expect(wallet.providerInfo?.name).not.toBe("P"); // Never adopt the other object's retained metadata.
      await wallet.selectProvider(uuid);
      expect(wallet.provider).toBe(fixtures[order[0] as keyof typeof fixtures].provider);
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
  ] as const)("preserves the explicit object during startup announcements %s (providerInfo=%s)", async (order, withInfo) => {
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
      expect(wallet.providers).toEqual([withInfo ? selected.info : fixtures[0]!.info]);
      await wallet.ready();
      await expect(wallet.getChainId()).resolves.toBe("dusk:2");
      expect(wallet.provider).toBe(selected.provider);
      expect(wallet.providerInfo?.name).not.toBe("P");
      expect(requests).toHaveBeenCalledTimes(1);
    } finally {
      wallet.destroy();
      fixtures.forEach(fixture => fixture.cleanup());
    }
  });

  it.each(["picker", "connect", "constructor"])("keeps the exact %s choice through collisions, requests and later switches", async choice => {
    const info = createMockProviderInfo({ uuid: "chosen", name: "Chosen Wallet" });
    if (choice === "connect") localStorage.setItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY, JSON.stringify({ version: 1, rdns: info.rdns }));
    const selected = createMockProvider({ accounts: ["chosen-account"] });
    const impostor = createMockProvider({ chainId: "dusk:999", accounts: ["impostor-account"], authorized: true });
    const healthy = createMockProvider({ accounts: ["healthy-account"], authorized: true });
    const wallet = createDuskWallet(choice === "constructor"
      ? { provider: selected, providerInfo: info, autoRefresh: false }
      : { autoRefresh: false, waitForProvider: false });
    onTestFinished(() => wallet.destroy());
    await wallet.ready();
    const announce = (provider = selected, metadata = info) => window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: metadata, provider }));
    announce();
    if (choice === "picker") await wallet.selectProvider(info.uuid);
    if (choice === "connect") await wallet.connect();
    else selected.setAuthorized(true);
    await wallet.refresh();
    const state = wallet.state;
    const epoch = wallet.selectionEpoch;
    const networkEpoch = wallet.networkEpoch;
    const chainEvents = vi.fn();
    wallet.on("chainChanged", chainEvents);
    let finish!: (value: string) => void;
    selected.setResponse("dusk_chainId", () => new Promise<string>(resolve => { finish = resolve; }));
    const pending = wallet.getChainId().catch(error => error);
    announce(impostor, { ...info, name: "Scam Wallet", rdns: "example.scam" });
    finish("dusk:2");
    expect(await pending).toBe("dusk:2");
    selected.setResponse("dusk_chainId", undefined);
    for (let i = 0; i < 2; i++) { announce(impostor); announce(); }
    await wallet.discoverProviders({ timeoutMs: 0 });
    expect(wallet.provider).toBe(selected);
    expect(wallet.selectionEpoch).toBe(epoch);
    expect(wallet.networkEpoch).toBe(networkEpoch);
    expect(wallet.state).toEqual(state);
    await wallet.selectProvider(info.uuid);
    expect(wallet.provider).toBe(selected);
    impostor.emit("chainChanged", "dusk:999");
    impostor.emit("profilesChanged", [{ profileId: "evil", account: "impostor-account" }]);
    impostor.emit("disconnect", { code: 4900, message: "forged" });
    impostor.emit("duskNodeChanged", { chainId: "dusk:999", nodeUrl: "https://scam.example", networkName: "Scam" });
    expect(wallet.state.node).toEqual(state.node);
    expect(wallet.networkEpoch).toBe(networkEpoch);
    expect(wallet.state.chainId).toBe("dusk:2");
    expect(wallet.state.accounts).toEqual(["chosen-account"]);
    expect(chainEvents).not.toHaveBeenCalled();
    selected.setChainId("dusk:3");
    expect(wallet.state.chainId).toBe("dusk:3");
    expect(chainEvents).toHaveBeenCalledWith("dusk:3");
    selected.setResponse("dusk_signMessage", { signature: "chosen-signature" });
    await expect(wallet.signMessage("hello")).resolves.toEqual({ signature: "chosen-signature" });
    const contract = createDuskContract({ contractId: "0x" + "11".repeat(32), wallet,
      driver: { encodeInputFn: () => new Uint8Array([1]) } as any });
    await expect(contract.write["ping"]!(null, { privacy: "public" })).resolves.toMatchObject({ hash: "0xtxhash" });
    expect(impostor.request).not.toHaveBeenCalled();
    expect(impostor.on).not.toHaveBeenCalled();
    await wallet.disconnect(); // Permission revocation does not change the chosen provider object.
    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.provider).toBe(selected);
    await wallet.connect();
    expect(wallet.state.accounts).toEqual(["chosen-account"]);
    announce(healthy, { ...info, uuid: "healthy", name: "Healthy Wallet" });
    expect(wallet.provider).toBe(selected); // Even a duplicate product hint cannot override the choice.
    selected.setResponse("dusk_chainId", () => new Promise<string>(resolve => { finish = resolve; }));
    const oldRead = wallet.getChainId().catch(error => error);
    await wallet.selectProvider("healthy");
    finish("dusk:3");
    expect(await oldRead).toBeInstanceOf(DuskWalletProviderChangedError);
    selected.setResponse("dusk_chainId", undefined);
    expect(wallet.provider).toBe(healthy);
    expect(wallet.selectionEpoch).toBe(epoch + 1);
    announce();
    announce(impostor);
    selected.setAccounts(["late-old-account"]);
    expect(wallet.state.accounts).toEqual(["healthy-account"]);
    await wallet.selectProvider(info.uuid);
    expect(wallet.provider).toBe(selected);
    expect(wallet.selectionEpoch).toBe(epoch + 2);
    expect(impostor.request).not.toHaveBeenCalled();
  });

  it.each(["picker", "connect", "constructor"])("preserves a %s choice while its initial RPC is pending", async choice => {
    const info = createMockProviderInfo();
    const selected = createMockProvider();
    let finish!: (value: any) => void;
    selected.setResponse(choice === "connect" ? "dusk_requestProfiles" : "dusk_chainId",
      () => new Promise(resolve => { finish = resolve; }));
    const wallet = createDuskWallet(choice === "constructor"
      ? { provider: selected, providerInfo: info }
      : { autoRefresh: false, waitForProvider: false });
    onTestFinished(() => wallet.destroy());
    if (choice !== "constructor") {
      await wallet.ready();
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: selected }));
    }
    const choosing = (choice === "constructor" ? wallet.ready()
      : choice === "picker" ? wallet.selectProvider(info.uuid) : wallet.connect()).catch(error => error);
    const epoch = wallet.selectionEpoch;
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: createMockProvider() }));
    finish(choice === "connect" ? [{ profileId: "approved", account: "chosen-account" }] : "dusk:2");
    const result = await choosing;
    if (choice === "constructor") expect(result).toBe(wallet);
    else expect(result).toMatchObject(choice === "connect"
      ? [{ profileId: "approved", account: "chosen-account" }]
      : { chainId: "dusk:2" });
    expect(wallet.state.chainId).toBe("dusk:2");
    expect(wallet.provider).toBe(selected);
    expect(wallet.selectionEpoch).toBe(epoch);
    expect(wallet.providerInfo).toEqual(info);
  });

  it.each(["single", "preferred", "stored", "connect-event"])("keeps an automatic %s selection after a duplicate UUID claim", async mode => {
    const info = createMockProviderInfo();
    if (mode === "stored") localStorage.setItem(DUSK_SELECTED_PROVIDER_STORAGE_KEY, JSON.stringify({ version: 1, rdns: info.rdns }));
    const selected = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false,
      ...(mode === "preferred" ? { preferredProviderId: info.uuid } : {}) });
    onTestFinished(() => wallet.destroy());
    await wallet.ready();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: selected }));
    if (mode === "connect-event") selected.emit("connect", { chainId: "dusk:2" });
    expect(wallet.provider).toBe(selected);
    const epoch = wallet.selectionEpoch;
    const later = createMockProvider();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: later }));
    expect(wallet.provider).toBe(selected);
    expect(wallet.selectionEpoch).toBe(epoch);
    await wallet.selectProvider(info.uuid);
    await wallet.connect();
    expect(wallet.provider).toBe(selected);
    expect(later.request).not.toHaveBeenCalled();
    expect(later.on).not.toHaveBeenCalled();
  });

  it("retains a reentrant forgery received first: first-seen discovery is not authentication", async () => {
    const info = createMockProviderInfo();
    const genuine = createMockProvider();
    const forged = createMockProvider();
    const intercept = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.provider === genuine) window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: detail.info, provider: forged }));
    };
    window.addEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, intercept);
    onTestFinished(() => window.removeEventListener(DUSK_ANNOUNCE_PROVIDER_EVENT, intercept));
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false });
    onTestFinished(() => wallet.destroy());
    await wallet.ready();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: genuine }));
    expect(wallet.provider).toBe(forged);
    expect(wallet.providers).toEqual([info]);
    await wallet.selectProvider(info.uuid);
    expect(wallet.provider).toBe(forged);
    expect(genuine.request).not.toHaveBeenCalled();
    expect(forged.request).toHaveBeenCalledWith({ method: "dusk_chainId", params: undefined });
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
      expect(restored.provider).toBe(next.provider); // Later discovery cannot evict an active selection.
      await restored.selectProvider(next.info.uuid);
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

  it.each([true, false])("ignores legacy conflict flags (%s) and later duplicate UUIDs", async conflicted => {
    const first = installReferenceWallet({ info: { uuid: "explicit" }, announceOnStart: false });
    const wallet = createDuskWallet({ provider: first.provider, providerInfo: { ...first.info, conflicted }, autoRefresh: false });
    let collision: ReturnType<typeof installReferenceWallet> | undefined;
    try {
      await wallet.ready();
      expect(wallet.provider).toBe(first.provider);
      expect(wallet.providers[0]?.conflicted).toBeUndefined();
      collision = installReferenceWallet({ info: { uuid: first.info.uuid }, announceOnStart: false });
      collision.announce();
      expect(wallet.provider).toBe(first.provider);
      expect(wallet.providerInfo).toEqual(first.info);
      expect(wallet.providers).toEqual([first.info]);
      await wallet.selectProvider(first.info.uuid);
      expect(wallet.provider).toBe(first.provider);
      first.announce();
      expect(wallet.providers[0]?.conflicted).toBeUndefined();
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
