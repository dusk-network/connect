import type { ChainId, SwitchChainParams } from "./types.js";
import type { DuskWallet } from "./wallet.js";
import { normalizeBaseUrl, normalizeCaip2ChainId } from "./internal/normalize.js";

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
  const refresh = opts.refresh !== false;
  if (refresh) {
    await wallet.refresh().catch(() => {});
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
    const currentRaw = await wallet.getChainId().catch(() => wallet.state.chainId);
    const current = normalizeCaip2ChainId(currentRaw ?? "");
    if (current && current === desired) return false;

    await wallet.switchChain({ chainId: desired as ChainId });
    return true;
  }

  // --- nodeUrl target
  const desiredNodeUrl = normalizeBaseUrl(desiredNodeUrlRaw);
  const currentNodeUrlRaw = wallet.state.node?.nodeUrl ? String(wallet.state.node.nodeUrl) : "";
  const currentNodeUrl = normalizeBaseUrl(currentNodeUrlRaw);

  if (currentNodeUrl) {
    if (opts.strictNodeUrl) {
      if (currentNodeUrlRaw.trim() === desiredNodeUrlRaw) return false;
    } else {
      if (currentNodeUrl === desiredNodeUrl) return false;
    }
  }

  await wallet.switchChain({ nodeUrl: desiredNodeUrlRaw });
  return true;
}
