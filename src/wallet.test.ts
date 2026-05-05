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
  DuskWalletProviderSelectionError,
  DuskWalletUnauthorizedError,
} from "./errors.js";
import { DuskWallet, createDuskWallet } from "./wallet.js";
import { createMockProvider, createMockProviderInfo, makeNodeChangedPayload } from "./test/mocks.js";

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

  it("translates provider rpc errors into wallet-specific errors", async () => {
    const provider = createMockProvider();
    provider.setResponse("dusk_getPublicBalance", async () => {
      throw Object.assign(new Error("locked"), { code: ERROR_CODES.UNAUTHORIZED });
    });

    const wallet = new DuskWallet({ provider, waitForProvider: false, autoRefresh: false });

    await expect(wallet.getPublicBalance()).rejects.toBeInstanceOf(DuskWalletUnauthorizedError);
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
