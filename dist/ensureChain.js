import { normalizeBaseUrl, normalizeCaip2ChainId } from "./internal/normalize.js";
/**
 * Tiny helper that checks whether the wallet is already on a target chain / node
 * and only calls `wallet.switchChain()` if needed.
 *
 * @returns `true` if the helper initiated a switch (i.e. it will prompt the user), otherwise `false`.
 */
export async function ensureChain(wallet, target, opts = {}) {
    const refresh = opts.refresh !== false;
    if (refresh) {
        await wallet.refresh().catch(() => { });
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
        if (current && current === desired)
            return false;
        await wallet.switchChain({ chainId: desired });
        return true;
    }
    // --- nodeUrl target
    const desiredNodeUrl = normalizeBaseUrl(desiredNodeUrlRaw);
    const currentNodeUrlRaw = wallet.state.node?.nodeUrl ? String(wallet.state.node.nodeUrl) : "";
    const currentNodeUrl = normalizeBaseUrl(currentNodeUrlRaw);
    if (currentNodeUrl) {
        if (opts.strictNodeUrl) {
            if (currentNodeUrlRaw.trim() === desiredNodeUrlRaw)
                return false;
        }
        else {
            if (currentNodeUrl === desiredNodeUrl)
                return false;
        }
    }
    await wallet.switchChain({ nodeUrl: desiredNodeUrlRaw });
    return true;
}
//# sourceMappingURL=ensureChain.js.map