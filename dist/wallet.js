import { DuskWalletNotInstalledError, DuskWalletDisconnectedError, DuskWalletUnauthorizedError, DuskWalletUserRejectedError, ERROR_CODES, normalizeError, } from "./errors.js";
export function isDuskProvider(value) {
    return (value &&
        typeof value === "object" &&
        value.isDusk === true &&
        typeof value.request === "function" &&
        typeof value.on === "function");
}
/** Return the injected provider (`window.dusk`) if present. */
export function getDuskProvider() {
    if (typeof window === "undefined")
        return null;
    const p = window.dusk;
    return isDuskProvider(p) ? p : null;
}
/** Wait briefly for provider injection (`window.dusk`). */
export async function waitForDuskProvider(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 2_000;
    const intervalMs = opts.intervalMs ?? 50;
    const immediate = getDuskProvider();
    if (immediate)
        return immediate;
    if (typeof window === "undefined")
        return null;
    return await new Promise((resolve) => {
        const t0 = Date.now();
        const timer = window.setInterval(() => {
            const p = getDuskProvider();
            if (p) {
                window.clearInterval(timer);
                resolve(p);
                return;
            }
            if (Date.now() - t0 >= timeoutMs) {
                window.clearInterval(timer);
                resolve(null);
            }
        }, intervalMs);
    });
}
const initialState = (installed) => ({
    installed,
    authorized: false,
    accounts: [],
    chainId: null,
    selectedAddress: null,
    node: null,
    capabilities: null,
    lastUpdated: Date.now(),
});
const cloneState = (st) => ({ ...st, accounts: [...st.accounts] });
const shallowArrayEq = (a, b) => {
    if (a === b)
        return true;
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
};
const translateProviderError = (err) => {
    const e = normalizeError(err);
    switch (e.code) {
        case ERROR_CODES.UNSUPPORTED:
            return new DuskWalletNotInstalledError(e.message);
        case ERROR_CODES.DISCONNECTED:
            return new DuskWalletDisconnectedError(e.message);
        case ERROR_CODES.UNAUTHORIZED:
            return new DuskWalletUnauthorizedError(e.message);
        case ERROR_CODES.USER_REJECTED:
            return new DuskWalletUserRejectedError(e.message);
        default:
            return e;
    }
};
/** Wrapper around the injected provider with a small reactive state store. */
export class DuskWallet {
    _provider = null;
    _state = initialState(false);
    _subs = new Set();
    _bound = false;
    _destroyed = false;
    _readyPromise;
    _accountsFrom(value) {
        return Array.isArray(value) ? value : [];
    }
    _setAccounts(value, opts = {}) {
        const next = this._accountsFrom(value);
        const selectedAddress = next[0] ?? null;
        const sameAccounts = shallowArrayEq(this._state.accounts, next);
        if (sameAccounts && this._state.selectedAddress === selectedAddress)
            return;
        const notify = opts.notify ?? !sameAccounts;
        this._patch({ accounts: next, selectedAddress }, { notify });
    }
    _setDisconnected() {
        if (!this._state.authorized && this._state.accounts.length === 0 && this._state.selectedAddress === null)
            return;
        this._patch({ authorized: false, accounts: [], selectedAddress: null });
    }
    _hydrateFromProvider(p, opts = {}) {
        this._patch({
            installed: true,
            chainId: p.chainId ?? this._state.chainId,
            selectedAddress: p.selectedAddress ?? this._state.selectedAddress,
            authorized: Boolean(p.isAuthorized),
        }, opts);
    }
    _onConnect = (payload) => {
        const nextChainId = payload?.chainId ?? this._provider?.chainId ?? null;
        if (this._state.authorized && this._state.chainId === nextChainId)
            return;
        this._patch({ authorized: true, chainId: nextChainId });
    };
    _onDisconnect = (_payload) => {
        this._setDisconnected();
    };
    _onAccountsChanged = (accounts) => {
        this._setAccounts(accounts);
    };
    _onChainChanged = (chainId) => {
        if (typeof chainId !== "string" || chainId === this._state.chainId)
            return;
        this._patch({ chainId });
    };
    _onNodeChanged = (payload) => {
        if (payload && typeof payload === "object") {
            this._patch({ node: payload, chainId: payload.chainId ?? this._state.chainId });
        }
    };
    _events = [
        ["connect", this._onConnect],
        ["disconnect", this._onDisconnect],
        ["accountsChanged", this._onAccountsChanged],
        ["chainChanged", this._onChainChanged],
        ["duskNodeChanged", this._onNodeChanged],
    ];
    constructor(opts = {}) {
        this._provider = opts.provider ?? getDuskProvider();
        this._state = initialState(Boolean(this._provider));
        this._readyPromise = (async () => {
            if (!this._provider && opts.waitForProvider !== false) {
                this._provider = await waitForDuskProvider(opts.providerWaitOptions);
                this._patch({ installed: Boolean(this._provider) }, { notify: false });
            }
            if (this._provider) {
                this._bindProviderEvents();
                this._hydrateFromProvider(this._provider, { notify: false });
                if (opts.autoRefresh !== false) {
                    await this.refresh().catch(() => { });
                }
            }
            this._notify();
        })();
    }
    _getProvider() {
        const p = this._provider ?? getDuskProvider();
        if (!p)
            return null;
        if (!this._provider) {
            this._provider = p;
            this._hydrateFromProvider(p, { notify: false });
            this._bindProviderEvents();
        }
        return p;
    }
    _requireProvider() {
        const p = this._getProvider();
        if (!p)
            throw new DuskWalletNotInstalledError();
        return p;
    }
    /** Resolves once initial provider detection/refresh finished. */
    async ready() {
        await this._readyPromise;
        return this;
    }
    /** The injected provider, if present. */
    get provider() {
        return this._provider;
    }
    /** Current reactive state (copy). */
    get state() {
        return cloneState(this._state);
    }
    /** Subscribe to state updates. Returns an unsubscribe function. */
    subscribe(fn) {
        this._subs.add(fn);
        try {
            fn(this.state);
        }
        catch {
            // ignore
        }
        return () => {
            this._subs.delete(fn);
        };
    }
    /** Low-level request wrapper. */
    async request(method, params) {
        const p = this._requireProvider();
        try {
            return await p.request({ method, params });
        }
        catch (err) {
            throw translateProviderError(err);
        }
    }
    /** Refresh chain id + accounts without prompting. */
    async refresh() {
        const p = this._getProvider();
        if (!p) {
            this._patch({ installed: false });
            return this.state;
        }
        const [caps, chainId, accounts] = await Promise.all([
            this.request("dusk_getCapabilities").catch(() => null),
            this.request("dusk_chainId").catch(() => p.chainId ?? null),
            this.request("dusk_accounts").catch(() => []),
        ]);
        const nextChainId = typeof chainId === "string" ? chainId : p.chainId ?? null;
        this._patch({
            chainId: nextChainId,
            capabilities: caps,
            authorized: Boolean(p.isAuthorized),
        }, { notify: false });
        this._setAccounts(accounts, { notify: false });
        this._notify();
        return this.state;
    }
    /** Prompt the user to connect (permission grant). */
    async connect() {
        const accountsRaw = await this.request("dusk_requestAccounts");
        const accounts = this._accountsFrom(accountsRaw);
        this._patch({ authorized: true, chainId: this._provider?.chainId ?? this._state.chainId }, { notify: false });
        this._setAccounts(accounts, { notify: false });
        this._notify();
        return accounts;
    }
    /** Revoke the site's connection permission. */
    async disconnect() {
        const res = await this.request("dusk_disconnect");
        this._setDisconnected();
        return Boolean(res);
    }
    async getAccounts() {
        const accounts = await this.request("dusk_accounts");
        return this._accountsFrom(accounts);
    }
    async getChainId() {
        return await this.request("dusk_chainId");
    }
    /** Request the wallet to switch its selected chain (prompts user). */
    async switchChain(params) {
        return await this.request("dusk_switchNetwork", [params]);
    }
    async getPublicBalance() {
        return await this.request("dusk_getPublicBalance");
    }
    /** Fetch current gas price stats from the node mempool. */
    async getGasPrice(opts) {
        return await this.request("dusk_estimateGas", opts ?? {});
    }
    async getCapabilities() {
        return await this.request("dusk_getCapabilities");
    }
    async signMessage(message) {
        return await this.request("dusk_signMessage", { message });
    }
    async signAuth(params) {
        return await this.request("dusk_signAuth", params);
    }
    async sendTransaction(params) {
        return await this.request("dusk_sendTransaction", params);
    }
    async sendTransfer(params) {
        return await this.sendTransaction({ kind: "transfer", ...params });
    }
    async sendContractCall(params) {
        return await this.sendTransaction({ kind: "contract_call", ...params });
    }
    /** Proxy provider events (typed). Returns an unsubscribe function. */
    on(eventName, handler) {
        const p = this._getProvider();
        if (!p)
            return () => { };
        p.on(eventName, handler);
        return () => p.off(eventName, handler);
    }
    /** Stop listening and free resources. */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._unbindProviderEvents();
        this._subs.clear();
    }
    _bindProviderEvents() {
        if (this._bound || !this._provider)
            return;
        this._bound = true;
        for (const [name, fn] of this._events)
            this._provider.on(name, fn);
    }
    _unbindProviderEvents() {
        if (!this._bound || !this._provider)
            return;
        this._bound = false;
        for (const [name, fn] of this._events)
            this._provider.off(name, fn);
    }
    _patch(partial, opts = {}) {
        this._state = { ...this._state, ...partial, lastUpdated: Date.now() };
        if (opts.notify !== false)
            this._notify();
    }
    _notify() {
        if (this._destroyed)
            return;
        const snapshot = this.state;
        for (const fn of this._subs) {
            try {
                fn(snapshot);
            }
            catch {
                // ignore
            }
        }
    }
}
/**
 * Create a {@link DuskWallet} instance.
 *
 * Use this when you only need access to the injected provider (`window.dusk`):
 * connect, read accounts/chain, balances, and send transactions.
 *
 * If you later need contract-friendly helpers (readContract / writeContract),
 * you can pass this same wallet instance into `createDuskApp({ wallet, ... })`.
 *
 * @example
 * ```ts
 * import { createDuskWallet } from "@dusk-network/connect";
 *
 * const wallet = createDuskWallet();
 * await wallet.ready();
 *
 * await wallet.connect();
 * console.log(wallet.state.accounts);
 * ```
 */
export function createDuskWallet(opts) {
    return new DuskWallet(opts);
}
//# sourceMappingURL=wallet.js.map