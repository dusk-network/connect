// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ERROR_CODES, DuskWalletUnauthorizedError } from "./errors.js";
import {
  DuskWallet,
  createDuskWallet,
  getDuskProvider,
  isDuskProvider,
  waitForDuskProvider,
} from "./wallet.js";
import { createMockProvider, makeNodeChangedPayload } from "./test/mocks.js";

describe("wallet", () => {
  beforeEach(() => {
    vi.useRealTimers();
    delete (window as any).dusk;
  });

  it("detects valid injected providers", () => {
    const provider = createMockProvider();
    expect(isDuskProvider(provider)).toBe(true);
    expect(isDuskProvider({ isDusk: true })).toBe(false);

    (window as any).dusk = provider;
    expect(getDuskProvider()).toBe(provider);
  });

  it("waits briefly for provider injection", async () => {
    vi.useFakeTimers();
    const promise = waitForDuskProvider({ timeoutMs: 100, intervalMs: 10 });

    vi.advanceTimersByTime(40);
    (window as any).dusk = createMockProvider();
    vi.advanceTimersByTime(10);

    await expect(promise).resolves.toBe((window as any).dusk);
  });

  it("refreshes state from the provider on ready", async () => {
    const provider = createMockProvider({
      authorized: true,
      accounts: ["dusk1alpha"],
      chainId: "dusk:3",
    });

    const wallet = createDuskWallet({
      provider,
      waitForProvider: false,
    });

    await wallet.ready();

    expect(wallet.state.installed).toBe(true);
    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.accounts).toEqual(["dusk1alpha"]);
    expect(wallet.state.selectedAddress).toBe("dusk1alpha");
    expect(wallet.state.chainId).toBe("dusk:3");
    expect(wallet.state.capabilities?.provider).toBe("dusk-wallet");
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
    provider.emit("disconnect", { code: ERROR_CODES.DISCONNECTED });

    expect(wallet.state.chainId).toBe("dusk:1");
    expect(wallet.state.node?.networkName).toBe("Mainnet");
    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(seen.some((value) => value.includes("dusk:1:dusk1next"))).toBe(true);
  });
});
