// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DUSK_ANNOUNCE_PROVIDER_EVENT,
  DUSK_REQUEST_PROVIDER_EVENT,
  makeDuskAnnounceProviderEvent,
  requestDuskProviders,
  waitForDuskProviders,
} from "./discovery.js";
import {
  ERROR_CODES,
  DuskWalletProviderChangedError,
  DuskWalletProviderSelectionError,
  DuskWalletUnauthorizedError,
} from "./errors.js";
import { DuskWallet, createDuskWallet } from "./wallet.js";
import { createMockProvider, createMockProviderInfo, makeNodeChangedPayload } from "./test/mocks.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function createMultiProviderWallet(
  primary: ReturnType<typeof createMockProvider>,
  secondary: ReturnType<typeof createMockProvider>
) {
  const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
  const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });
  const onRequest = () => {
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
  };
  window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  const wallet = createDuskWallet({ autoRefresh: false });
  await wallet.ready();
  await wallet.selectProvider("wallet.primary");
  return {
    wallet,
    cleanup: () => {
      wallet.destroy();
      window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
    },
  };
}

describe("wallet", () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects providers announced over the discovery API", async () => {
    const provider = createMockProvider();
    const info = createMockProviderInfo({
      uuid: "wallet.one",
      name: "Wallet One",
      rdns: "network.dusk.wallet.one",
    });

    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider }));
    };

    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    await expect(requestDuskProviders({ timeoutMs: 0 })).resolves.toEqual([{ info, provider }]);

    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("waits briefly for provider discovery", async () => {
    vi.useFakeTimers();

    const provider = createMockProvider();
    const info = createMockProviderInfo({ uuid: "wallet.delayed", name: "Delayed Wallet" });

    const onRequest = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, { detail: { info, provider } }));
      }, 40);
    };

    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const promise = waitForDuskProviders({ timeoutMs: 100, intervalMs: 10 });
    vi.advanceTimersByTime(50);

    await expect(promise).resolves.toEqual([{ info, provider }]);

    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("auto-selects the only discovered wallet and refreshes state on ready", async () => {
    const provider = createMockProvider({
      authorized: true,
      accounts: ["dusk1alpha"],
      chainId: "dusk:3",
    });
    const info = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });

    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider }));
    };

    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet();
    await wallet.ready();

    expect(wallet.state.installed).toBe(true);
    expect(wallet.state.providerId).toBe("wallet.primary");
    expect(wallet.state.providerInfo?.name).toBe("Primary Wallet");
    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual(["wallet.primary"]);
    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.accounts).toEqual(["dusk1alpha"]);
    expect(wallet.state.selectedAddress).toBe("dusk1alpha");
    expect(wallet.state.chainId).toBe("dusk:3");
    expect(wallet.state.capabilities?.provider).toBe("dusk-wallet");

    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("hydrates node state from provider capabilities", async () => {
    const provider = createMockProvider({
      authorized: true,
      chainId: "dusk:3",
      capabilities: {
        chainId: "dusk:0",
        nodeUrl: " http://127.0.0.1:18181 ",
        networkName: "Local",
      },
      responses: {
        dusk_chainId: () => {
          throw new Error("chain unavailable");
        },
      },
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false });

    await wallet.ready();

    expect(wallet.state.chainId).toBe("dusk:0");
    expect(wallet.state.node).toEqual({
      chainId: "dusk:0",
      nodeUrl: "http://127.0.0.1:18181",
      networkName: "Local",
    });
  });

  it("requires selecting a provider when multiple wallets are discovered", async () => {
    const primary = createMockProvider({ accounts: ["dusk1primary"] });
    const secondary = createMockProvider({ accounts: ["dusk1secondary"] });
    const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
    const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });

    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
    };

    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet();
    await wallet.ready();

    expect(wallet.state.installed).toBe(true);
    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual([
      "wallet.primary",
      "wallet.secondary",
    ]);
    expect(wallet.state.providerId).toBeNull();
    await expect(wallet.connect()).rejects.toBeInstanceOf(DuskWalletProviderSelectionError);

    await wallet.selectProvider("wallet.secondary");
    await expect(wallet.connect()).resolves.toEqual([{ profileId: "profile:0", account: "dusk1secondary" }]);
    expect(wallet.state.providerId).toBe("wallet.secondary");
    expect(wallet.state.providerInfo?.name).toBe("Secondary Wallet");

    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("does not let a stale refresh overwrite a newly selected provider", async () => {
    const primary = createMockProvider({ chainId: "dusk:1" });
    const secondary = createMockProvider({ chainId: "dusk:2" });
    const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
    const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });
    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
    };
    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet({ autoRefresh: false });
    await wallet.ready();
    await wallet.selectProvider("wallet.primary");
    const delayedChain = deferred<any>();
    primary.setResponse("dusk_chainId", () => delayedChain.promise);
    const staleRefresh = wallet.refresh();
    await Promise.resolve();

    await wallet.selectProvider("wallet.secondary");
    delayedChain.resolve("dusk:1");

    await expect(staleRefresh).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    expect(wallet.state.providerId).toBe("wallet.secondary");
    expect(wallet.state.chainId).toBe("dusk:2");

    wallet.destroy();
    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("does not commit a delayed connection from a previous provider", async () => {
    const primary = createMockProvider();
    const secondary = createMockProvider();
    const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
    const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });
    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
    };
    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet({ autoRefresh: false });
    await wallet.ready();
    await wallet.selectProvider("wallet.primary");
    const delayedProfiles = deferred<any>();
    primary.setResponse("dusk_requestProfiles", () => delayedProfiles.promise);
    const staleConnect = wallet.connect();
    await Promise.resolve();

    await wallet.selectProvider("wallet.secondary");
    delayedProfiles.resolve([{ profileId: "primary", account: "dusk1primary" }]);

    await expect(staleConnect).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    expect(wallet.state.providerId).toBe("wallet.secondary");
    expect(wallet.state.accounts).toEqual([]);

    wallet.destroy();
    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("rechecks selection before committing connected profiles", async () => {
    const primary = createMockProvider();
    const secondary = createMockProvider();
    const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
    const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });
    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
    };
    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet({ autoRefresh: false });
    await wallet.ready();
    await wallet.selectProvider("wallet.primary");
    const delayedProfiles = deferred<any>();
    primary.setResponse("dusk_requestProfiles", () => delayedProfiles.promise);

    const selecting = delayedProfiles.promise.then(() => wallet.selectProvider("wallet.secondary"));
    const connecting = wallet.connect();
    delayedProfiles.resolve([{ profileId: "primary", account: "dusk1primary" }]);

    await selecting;
    await expect(connecting).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    expect(wallet.state.providerId).toBe("wallet.secondary");
    expect(wallet.state.accounts).toEqual([]);

    wallet.destroy();
    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("moves application event listeners with the selected provider", async () => {
    const primary = createMockProvider();
    const secondary = createMockProvider();
    const primaryInfo = createMockProviderInfo({ uuid: "wallet.primary", name: "Primary Wallet" });
    const secondaryInfo = createMockProviderInfo({ uuid: "wallet.secondary", name: "Secondary Wallet" });
    const onRequest = () => {
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: primaryInfo, provider: primary }));
      window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: secondaryInfo, provider: secondary }));
    };
    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    let wallet: ReturnType<typeof createDuskWallet>;
    let selecting!: Promise<unknown>;
    primary.on("profilesChanged", () => { selecting = wallet.selectProvider("wallet.secondary"); });
    wallet = createDuskWallet({ autoRefresh: false });
    await wallet.ready();
    await wallet.selectProvider("wallet.primary");
    const chains: string[] = [];
    const profiles: unknown[] = [];
    wallet.on("chainChanged", (chainId) => chains.push(chainId));
    wallet.on("profilesChanged", (value) => profiles.push(value));
    primary.emit("profilesChanged", [{ profileId: "stale", account: "dusk1stale" }]);
    await selecting;

    expect(wallet.state.providerId).toBe("wallet.secondary");
    expect(wallet.state.accounts).toEqual([]);
    expect(profiles).toEqual([]);

    primary.emit("chainChanged", "dusk:1");
    secondary.emit("chainChanged", "dusk:3");
    expect(chains).toEqual(["dusk:3"]);

    wallet.destroy();
    secondary.emit("chainChanged", "dusk:4");
    expect(chains).toEqual(["dusk:3"]);
    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });

  it("does not deliver an in-flight event to newly added listeners", () => {
    const provider = createMockProvider();
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });
    const late = vi.fn();
    const fromState = vi.fn();
    let stateNotifications = 0;
    wallet.subscribe(() => {
      if (stateNotifications++) wallet.on("chainChanged", fromState);
    });
    const networkEpoch = wallet.networkEpoch;
    wallet.on("chainChanged", () => wallet.on("chainChanged", late));

    provider.emit("chainChanged", "dusk:3");
    expect(late).not.toHaveBeenCalled();
    expect(fromState).not.toHaveBeenCalled();
    provider.emit("chainChanged", "dusk:2");
    expect(late).toHaveBeenCalledTimes(1);
    expect(fromState).toHaveBeenCalledTimes(1);
    expect(wallet.networkEpoch).toBe(networkEpoch + 2);
    provider.emit("duskNodeChanged", {
      chainId: "dusk:2",
      networkName: "Original",
      nodeUrl: "https://testnet.nodes.dusk.network",
    });
    const stableEpoch = wallet.networkEpoch;
    provider.emit("duskNodeChanged", {
      nodeUrl: "https://testnet.nodes.dusk.network",
      networkName: "Renamed",
      chainId: "dusk:2",
    });
    expect(wallet.networkEpoch).toBe(stableEpoch);
  });

  it("stops delivering an event after a listener changes providers", async () => {
    const primary = createMockProvider();
    const secondary = createMockProvider();
    const { wallet, cleanup } = await createMultiProviderWallet(primary, secondary);
    const later = vi.fn();
    const networkEpoch = wallet.networkEpoch;
    await wallet.selectProvider("wallet.primary");
    expect(wallet.networkEpoch).toBe(networkEpoch);
    let selecting!: Promise<unknown>;
    wallet.on("chainChanged", () => { selecting = wallet.selectProvider("wallet.secondary"); });
    wallet.on("chainChanged", later);

    primary.emit("chainChanged", "dusk:2");
    await selecting;

    expect(later).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not bind a provider discovered after destruction", async () => {
    const provider = createMockProvider();
    const info = createMockProviderInfo({ uuid: "wallet.late", name: "Late Wallet" });
    const wallet = createDuskWallet({
      autoRefresh: false,
      providerWaitOptions: { timeoutMs: 100, intervalMs: 100 },
    });
    wallet.destroy();
    await Promise.resolve();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider }));
    await wallet.ready();

    expect(wallet.provider).toBeNull();
    expect(provider.on).not.toHaveBeenCalled();
  });

  it("rejects requests without calling the provider after destruction", async () => {
    const provider = createMockProvider();
    const providerInfo = createMockProviderInfo({ uuid: "wallet.destroyed" });
    const wallet = createDuskWallet({
      provider,
      providerInfo,
      waitForProvider: false,
      autoRefresh: false,
    });
    const providerId = providerInfo.uuid;
    wallet.destroy();

    await expect(wallet.selectProvider(providerId)).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    await expect(wallet.connect()).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    await expect(wallet.refresh()).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    await expect(wallet.discoverProviders()).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    const subscriber = vi.fn();
    wallet.subscribe(subscriber);
    expect(subscriber).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("translates provider rpc errors into wallet-specific errors", async () => {
    const provider = createMockProvider();
    provider.setResponse("dusk_getPublicBalance", async () => {
      throw Object.assign(new Error("locked"), { code: ERROR_CODES.UNAUTHORIZED });
    });

    const wallet = new DuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(wallet.getPublicBalance()).rejects.toBeInstanceOf(DuskWalletUnauthorizedError);
  });

  it("reports provider changes instead of stale request errors", async () => {
    const primary = createMockProvider();
    const secondary = createMockProvider();
    const { wallet, cleanup } = await createMultiProviderWallet(primary, secondary);
    const balance = deferred<any>();
    primary.setResponse("dusk_getPublicBalance", () => balance.promise);

    const pending = wallet.getPublicBalance();
    await wallet.selectProvider("wallet.secondary");
    balance.reject(Object.assign(new Error("locked"), { code: ERROR_CODES.UNAUTHORIZED }));

    await expect(pending).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    cleanup();
  });

  it("connects, disconnects, and normalizes watched assets", async () => {
    const provider = createMockProvider({
      accounts: ["dusk1watched"],
      authorized: false,
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(wallet.connect()).resolves.toEqual([{ profileId: "profile:0", account: "dusk1watched" }]);
    expect(wallet.state.authorized).toBe(true);

    const contractBytes = new Uint8Array(32).map((_, index) => index);
    await expect(
      wallet.watchAsset(
        {
          type: "DRC721",
          options: {
            contractId: contractBytes,
            tokenId: 42n,
          },
        },
        { autoConnect: false }
      )
    ).resolves.toBe(true);

    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_watchAsset",
      params: {
        type: "DRC721",
        options: {
          contractId:
            "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
          tokenId: "42",
        },
      },
    });

    await expect(wallet.disconnect()).resolves.toBe(true);
    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
  });

  it("does not watch an asset through a provider selected by a state callback", async () => {
    const primary = createMockProvider({ accounts: ["dusk1primary"], authorized: false });
    const secondary = createMockProvider({ accounts: ["dusk1secondary"], authorized: true });
    const { wallet, cleanup } = await createMultiProviderWallet(primary, secondary);
    let selecting: Promise<unknown> | undefined;
    wallet.subscribe((state) => {
      if (state.authorized && state.providerId === "wallet.primary") {
        selecting = wallet.selectProvider("wallet.secondary");
      }
    });

    await expect(
      wallet.watchAsset({
        type: "DRC20",
        options: { contractId: "0x" + "11".repeat(32) },
      })
    ).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    await selecting;
    expect(secondary.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "dusk_watchAsset" })
    );
    cleanup();
  });

  it("requests a shielded receive address and updates profile state from the grant", async () => {
    const provider = createMockProvider({
      authorized: false,
      accounts: ["dusk1public"],
      shieldedAddress: "dusk1shieldedreceive",
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(wallet.requestShieldedAddress({ reason: "payment_request" })).resolves.toBe("dusk1shieldedreceive");
    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.accounts).toEqual(["dusk1public"]);
    expect(wallet.state.selectedProfile).toEqual({
      profileId: "profile:0",
      account: "dusk1public",
      shieldedAddress: "dusk1shieldedreceive",
    });
    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_requestShieldedAddress",
      params: { reason: "payment_request" },
    });
  });

  it("updates shielded address grants by profile id", async () => {
    const provider = createMockProvider({
      authorized: false,
      accounts: ["dusk1publicpair"],
      shieldedAddress: "dusk1pairedshielded",
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await wallet.connect();
    await expect(wallet.requestShieldedAddress({ reason: "payment_request" })).resolves.toBe("dusk1pairedshielded");

    expect(wallet.state.selectedProfile).toEqual({
      profileId: "profile:0",
      account: "dusk1publicpair",
      shieldedAddress: "dusk1pairedshielded",
    });

    provider.setAccounts(["dusk1publicpair"]);
    expect(wallet.state.selectedProfile?.shieldedAddress).toBeUndefined();
  });

  it("connects with an explicitly requested shielded receive address on the selected profile", async () => {
    const provider = createMockProvider({
      authorized: false,
      accounts: ["dusk1publicprofile"],
      shieldedAddress: "dusk1profiledshielded",
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(wallet.connect({ shieldedReceiveAddress: true, reason: "payment_request" })).resolves.toEqual([
      {
        profileId: "profile:0",
        account: "dusk1publicprofile",
        shieldedAddress: "dusk1profiledshielded",
      },
    ]);

    expect(wallet.state.accounts).toEqual(["dusk1publicprofile"]);
    expect(wallet.state.selectedProfile).toEqual({
      profileId: "profile:0",
      account: "dusk1publicprofile",
      shieldedAddress: "dusk1profiledshielded",
    });
    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_requestProfiles",
      params: { shieldedReceiveAddress: true, reason: "payment_request" },
    });
  });

  it("forwards shielded transfer privacy before sending to the provider", async () => {
    const provider = createMockProvider({ authorized: true, accounts: ["dusk1payer"] });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(
      wallet.sendTransfer({
        privacy: "shielded",
        to: "dusk1recipientshielded",
        amount: "5000000000",
        memo: "DuskSend:test",
      })
    ).resolves.toEqual({ hash: "0xtxhash", nonce: "7" });

    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_sendTransaction",
      params: {
        kind: "transfer",
        privacy: "shielded",
        to: "dusk1recipientshielded",
        amount: "5000000000",
        memo: "DuskSend:test",
      },
    });
  });

  it("preserves a successful transaction result after provider selection changes", async () => {
    const primary = createMockProvider({ authorized: true });
    const secondary = createMockProvider({ authorized: true });
    const { wallet, cleanup } = await createMultiProviderWallet(primary, secondary);
    const submitted = deferred<any>();
    primary.setResponse("dusk_sendTransaction", () => submitted.promise);

    const pending = wallet.request("dusk_sendTransaction", {
      kind: "transfer",
      privacy: "public",
      to: "dusk1recipient",
      amount: "1",
    });
    await wallet.selectProvider("wallet.secondary");
    submitted.resolve({ hash: "0xsubmitted", nonce: "8" });

    await expect(pending).resolves.toEqual({ hash: "0xsubmitted", nonce: "8" });
    cleanup();
  });

  it("normalizes explicit-private contract calls before forwarding to the provider", async () => {
    const provider = createMockProvider({ authorized: true, accounts: ["dusk1payer"] });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });
    const contractId = new Uint8Array(32).fill(0x11);

    await expect(
      wallet.sendContractCall({
        privacy: "shielded",
        contractId,
        fnName: " pay_with_deposit ",
        fnArgs: new Uint8Array([0xab, 0xcd]),
        deposit: "4250000000",
        display: {
          title: "Private contract call",
          referenceCommitment: "aa".repeat(32),
        },
      })
    ).resolves.toEqual({ hash: "0xtxhash", nonce: "7" });

    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_sendTransaction",
      params: {
        kind: "contract_call",
        privacy: "shielded",
        contractId: "0x" + "11".repeat(32),
        fnName: "pay_with_deposit",
        fnArgs: "0xabcd",
        deposit: "4250000000",
        display: {
          title: "Private contract call",
          referenceCommitment: "aa".repeat(32),
        },
      },
    });
  });

  it("rejects transfer privacy when missing or invalid", async () => {
    const provider = createMockProvider({ authorized: true, accounts: ["dusk1payer"] });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(
      wallet.sendTransfer({
        to: "dusk1recipient",
        amount: "1",
      } as any)
    ).rejects.toThrow('privacy is required ("public" or "shielded")');

    await expect(
      wallet.sendTransfer({
        privacy: "private",
        to: "dusk1recipient",
        amount: "1",
      } as any)
    ).rejects.toThrow('privacy must be "public" or "shielded"');
  });

  it("passes explicit public transfer privacy through", async () => {
    const provider = createMockProvider({ authorized: true, accounts: ["dusk1payer"] });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(
      wallet.sendTransfer({
        privacy: "public",
        to: "dusk1recipientpublic",
        amount: "1000",
      })
    ).resolves.toEqual({ hash: "0xtxhash", nonce: "7" });

    expect(provider.request).toHaveBeenLastCalledWith({
      method: "dusk_sendTransaction",
      params: {
        kind: "transfer",
        privacy: "public",
        to: "dusk1recipientpublic",
        amount: "1000",
      },
    });
  });

  it("clears visible profiles on profilesChanged([]) without revoking authorization", async () => {
    const provider = createMockProvider({
      authorized: false,
      accounts: ["dusk1public"],
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await wallet.connect();
    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.profiles).toHaveLength(1);

    provider.emit("profilesChanged", []);

    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.profiles).toEqual([]);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.state.selectedProfile).toBeNull();
    expect(wallet.state.selectedAddress).toBeNull();
  });

  it("does not preserve stale shielded addresses from passive profile responses", async () => {
    const provider = createMockProvider({
      authorized: false,
      accounts: ["dusk1public"],
      shieldedAddress: "dusk1shielded",
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await wallet.connect({ shieldedReceiveAddress: true });
    expect(wallet.state.selectedProfile?.shieldedAddress).toBe("dusk1shielded");

    provider.emit("profilesChanged", [{ profileId: "profile:0", account: "dusk1public" }]);

    expect(wallet.state.selectedProfile).toEqual({
      profileId: "profile:0",
      account: "dusk1public",
    });
  });

  it("reacts to provider events and notifies subscribers", async () => {
    const provider = createMockProvider({
      authorized: true,
      accounts: ["dusk1start"],
    });
    const wallet = createDuskWallet({ provider, waitForProvider: false, autoRefresh: false });
    const seen: string[] = [];

    wallet.subscribe((state) => {
      seen.push(`${state.chainId ?? "none"}:${state.accounts[0] ?? "none"}`);
    });

    await wallet.ready();
    provider.setChainId("dusk:1");
    provider.setAccounts(["dusk1next"]);
    provider.emit("duskNodeChanged", makeNodeChangedPayload({ chainId: "dusk:1", networkName: "Mainnet" }));
    provider.emit("disconnect", { code: ERROR_CODES.DISCONNECTED, message: "Disconnected" });

    expect(wallet.state.chainId).toBe("dusk:1");
    expect(wallet.state.node?.networkName).toBe("Mainnet");
    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(seen.some((value) => value.includes("dusk:1:dusk1next"))).toBe(true);
  });
});
