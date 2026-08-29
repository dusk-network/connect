import type { ChainId, DuskProvider, SwitchChainParams } from "./types.js";
import type { DuskWallet } from "./wallet.js";
import { DuskWalletProviderChangedError } from "./errors.js";
import { normalizeBaseUrl, normalizeCaip2ChainId } from "./internal/normalize.js";

/** Options for {@link ensureChain}. */
export type EnsureChainOptions = {
  /**
   * If true, the helper will call `wallet.refresh()` first (no prompt).
   * Default: true
   */
  refresh?: boolean;

  /**
   * If `nodeUrl` is provided and the wallet has emitted `duskNodeChanged`,
   * require the current `nodeUrl` to match exactly.
   * Default: false
   */
  strictNodeUrl?: boolean;

  /** Require the wallet selection to remain unchanged throughout the check. */
  selection?: { provider: DuskProvider | null; epoch: number };
};


/**
 * Tiny helper that checks whether the wallet is already on a target chain / node
 * and only calls `wallet.switchChain()` if needed.
 *
 * @returns `true` if the helper initiated a switch (i.e. it will prompt the user), otherwise `false`.
 */
export async function ensureChain(
  wallet: DuskWallet,
  target: SwitchChainParams,
  opts: EnsureChainOptions = {}
): Promise<boolean> {
  let provider = wallet.provider;
  if (!provider && !opts.selection) {
    await wallet.ready();
    provider = wallet.provider;
  }
  const selection = opts.selection ?? { provider, epoch: wallet.selectionEpoch };
  const assertSelection = () => {
    if (wallet.provider !== selection.provider || wallet.selectionEpoch !== selection.epoch) {
      throw new DuskWalletProviderChangedError();
    }
  };
  const bestEffort = async <T>(promise: Promise<T>, fallback: () => T): Promise<T> => {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof DuskWalletProviderChangedError) throw error;
      return fallback();
    }
  };

  assertSelection();
  const refresh = opts.refresh !== false;
  if (refresh) {
    await bestEffort(wallet.refresh(), () => wallet.state);
    assertSelection();
  }

  const desiredChainIdRaw = typeof target?.chainId === "string" ? target.chainId.trim() : "";
  const desiredNodeUrlRaw = typeof target?.nodeUrl === "string" ? target.nodeUrl.trim() : "";

  if (!desiredChainIdRaw && !desiredNodeUrlRaw) {
    throw new Error("ensureChain: expected { chainId } or { nodeUrl }");
  }

  // --- chainId target
  if (desiredChainIdRaw) {
    const desired = normalizeCaip2ChainId(desiredChainIdRaw);
    if (!desired) {
      throw new Error("ensureChain: chainId must be CAIP-2 (dusk:<id>)");
    }
    const currentRaw = await bestEffort(wallet.getChainId(), () => wallet.state.chainId);
    assertSelection();
    const current = normalizeCaip2ChainId(currentRaw ?? "");
    if (current && current === desired) {
      assertSelection();
      return false;
    }

    await wallet.switchChain({ chainId: desired as ChainId });
    assertSelection();
    return true;
  }

  // --- nodeUrl target
  const desiredNodeUrl = normalizeBaseUrl(desiredNodeUrlRaw);
  const currentNodeUrlRaw = wallet.state.node?.nodeUrl ? String(wallet.state.node.nodeUrl) : "";
  const currentNodeUrl = normalizeBaseUrl(currentNodeUrlRaw);

  if (currentNodeUrl) {
    if (opts.strictNodeUrl) {
      if (currentNodeUrlRaw.trim() === desiredNodeUrlRaw) {
        assertSelection();
        return false;
      }
    } else {
      if (currentNodeUrl === desiredNodeUrl) {
        assertSelection();
        return false;
      }
    }
  }

  assertSelection();
  await wallet.switchChain({ nodeUrl: desiredNodeUrlRaw });
  assertSelection();
  return true;
}
