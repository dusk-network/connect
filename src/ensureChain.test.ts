import { describe, expect, it, vi } from "vitest";

import { DuskWalletProviderChangedError } from "./errors.js";
import { ensureChain } from "./ensureChain.js";

function createWalletStub(overrides: {
  chainId?: string | null;
  nodeUrl?: string | null;
} = {}) {
  const state = {
    chainId: overrides.chainId ?? "dusk:2",
    node: overrides.nodeUrl
      ? {
          chainId: overrides.chainId ?? "dusk:2",
          nodeUrl: overrides.nodeUrl,
          networkName: "Testnet",
        }
      : null,
  };

  return {
    state,
    provider: { id: "provider" },
    selectionEpoch: 0,
    ready: vi.fn(async () => null),
    refresh: vi.fn(async () => state),
    getChainId: vi.fn(async () => state.chainId),
    switchChain: vi.fn(async () => null),
  } as any;
}

describe("ensureChain", () => {
  it("throws on empty targets", async () => {
    await expect(ensureChain(createWalletStub(), {})).rejects.toThrow(/expected \{ chainId \} or \{ nodeUrl \}/i);
  });

  it("refreshes by default and skips switching when chain already matches", async () => {
    const wallet = createWalletStub({ chainId: "dusk:2" });
    const changed = await ensureChain(wallet, { chainId: "DUSK:2" });

    expect(changed).toBe(false);
    expect(wallet.refresh).toHaveBeenCalledTimes(1);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("switches when the desired chain differs", async () => {
    const wallet = createWalletStub({ chainId: "dusk:1" });
    const changed = await ensureChain(wallet, { chainId: "dusk:2" }, { refresh: false });

    expect(changed).toBe(true);
    expect(wallet.refresh).not.toHaveBeenCalled();
    expect(wallet.switchChain).toHaveBeenCalledWith({ chainId: "dusk:2" });
  });

  it("rejects when the provider changes during a standalone check", async () => {
    const wallet = createWalletStub({ chainId: "dusk:1" });
    wallet.provider = { id: "primary" };
    wallet.selectionEpoch = 1;
    wallet.refresh.mockImplementation(async () => {
      wallet.provider = { id: "secondary" };
      wallet.selectionEpoch = 2;
      return wallet.state;
    });

    await expect(ensureChain(wallet, { chainId: "dusk:2" })).rejects.toThrow(/provider changed/i);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("waits for initial provider selection before capturing the generation", async () => {
    const wallet = createWalletStub({ chainId: "dusk:2" });
    wallet.provider = null;
    wallet.ready.mockImplementation(async () => {
      wallet.provider = { id: "provider" };
      wallet.selectionEpoch = 1;
    });

    await expect(ensureChain(wallet, { chainId: "dusk:2" })).resolves.toBe(false);
  });

  it("rejects stale selections on no-op paths", async () => {
    const wallet = createWalletStub({ chainId: "dusk:2" });
    const provider = { id: "provider" };
    wallet.provider = provider;
    wallet.selectionEpoch = 2;

    await expect(
      ensureChain(wallet, { chainId: "dusk:2" }, {
        refresh: false,
        selection: { provider, epoch: 1 },
      })
    ).rejects.toThrow(/provider changed/i);
  });

  it("does not swallow provider-change errors from refresh", async () => {
    const wallet = createWalletStub({ chainId: "dusk:2" });
    wallet.refresh.mockRejectedValue(new DuskWalletProviderChangedError());
    await expect(ensureChain(wallet, { chainId: "dusk:2" })).rejects.toBeInstanceOf(
      DuskWalletProviderChangedError
    );
  });

  it("reads fallback chain state after a failed request", async () => {
    const wallet = createWalletStub({ chainId: "dusk:1" });
    wallet.getChainId.mockImplementation(async () => {
      wallet.state.chainId = "dusk:2";
      throw new Error("unavailable");
    });

    await expect(ensureChain(wallet, { chainId: "dusk:2" }, { refresh: false })).resolves.toBe(false);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("rejects invalid CAIP-2 chain ids", async () => {
    await expect(ensureChain(createWalletStub(), { chainId: "bad-chain" })).rejects.toThrow(
      /chainId must be CAIP-2/i
    );
  });

  it("normalizes node urls before comparing in non-strict mode", async () => {
    const wallet = createWalletStub({ nodeUrl: "https://nodes.dusk.network/" });
    const changed = await ensureChain(wallet, { nodeUrl: "https://nodes.dusk.network" });

    expect(changed).toBe(false);
    expect(wallet.switchChain).not.toHaveBeenCalled();
  });

  it("uses the raw string in strict node url mode", async () => {
    const wallet = createWalletStub({ nodeUrl: "https://nodes.dusk.network/" });
    const changed = await ensureChain(wallet, { nodeUrl: "https://nodes.dusk.network" }, { strictNodeUrl: true });

    expect(changed).toBe(true);
    expect(wallet.switchChain).toHaveBeenCalledWith({ nodeUrl: "https://nodes.dusk.network" });
  });
});
