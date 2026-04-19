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
    await expect(wallet.connect()).resolves.toEqual(["dusk1secondary"]);
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

    await expect(wallet.connect()).resolves.toEqual(["dusk1watched"]);
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
