import { describe, expect, it, vi } from "vitest";

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
