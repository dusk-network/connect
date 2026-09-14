// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DuskWalletProviderChangedError, DuskWalletProviderSelectionError } from "./errors.js";
import { DUSK_SELECTED_PROVIDER_STORAGE_KEY, requestDuskProviders } from "./discovery.js";
import { installReferenceWallet } from "./test/referenceWallet.js";
import { createDuskWallet } from "./wallet.js";

describe("integration: multi-provider wallet selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
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
