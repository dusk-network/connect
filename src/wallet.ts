import type {
  AccountId,
  BalanceResult,
  ByteLike,
  ChainId,
  ConnectOptions,
  DuskProfile,
  DuskProvider,
  DuskProviderCapabilities,
  DuskProviderDetail,
  DuskProviderEventMap,
  DuskProviderInfo,
  DuskWalletState,
  GasPriceResult,
  Address,
  RequestShieldedAddressParams,
  RequestShieldedAddressResponse,
  SendTransactionParams,
  SignAuthParams,
  SignAuthResult,
  SignMessageResult,
  SwitchChainParams,
  WatchAssetParams,
  TxResult,
} from "./types.js";

import {
  DuskSdkError,
  DuskWalletDisconnectedError,
  DuskWalletNotInstalledError,
  DuskWalletProviderChangedError,
  DuskWalletProviderNotFoundError,
  DuskWalletProviderSelectionError,
  DuskWalletRequestTimeoutError,
  DuskWalletUnauthorizedError,
  DuskWalletUnsupportedMethodError,
  DuskWalletUserRejectedError,
  ERROR_CODES,
  normalizeError,
  type RpcErrorLike,
} from "./errors.js";

import {
  DUSK_SELECTED_PROVIDER_STORAGE_KEY,
  isDuskProvider,
  registerDiscoveredProvider,
  requestDuskProviders,
  subscribeDuskProviders,
  waitForDuskProviders,
  type RequestDuskProvidersOptions,
  type WaitForDuskProvidersOptions,
} from "./discovery.js";

import { normalizeContractId0x } from "./internal/contractId.js";
import { normalizeBaseUrl, normalizeNodeUrl } from "./internal/normalize.js";
import { bytesToHex, toBytes } from "./bytes.js";

/** Provider discovery wait options used by {@link DuskWallet}. */
export type WaitForProviderOptions = WaitForDuskProvidersOptions;

/** Options for constructing a {@link DuskWallet} wrapper. */
export type DuskWalletOptions = {
  /** Provide a provider explicitly (useful for tests or custom integrations). */
  provider?: DuskProvider | null;

  /** Metadata for an explicitly provided provider. */
  providerInfo?: DuskProviderInfo | null;

  /** Preferred current-page provider UUID; an unmatched ID requires explicit selection. */
  preferredProviderId?: string | null;

  /** If no provider is selected synchronously, wait briefly for discovery. Default: true. */
  waitForProvider?: boolean;

  /** Discovery polling options (only used if `waitForProvider !== false`). */
  providerWaitOptions?: WaitForProviderOptions;

  /** Immediately fetch `dusk_chainId` and `dusk_profiles` on init. Default: true. */
  autoRefresh?: boolean;

  /** Deadline for capabilities, chain, profiles, balance and gas reads. Positive integer ms; default: 10_000. */
  providerReadTimeoutMs?: number;

  /** Remember the selected product's rdns; restore only a unique match. Default: true. */
  rememberLastUsedProvider?: boolean;

  /** localStorage key used for provider persistence. */
  providerStorageKey?: string;
};

/** Subscriber callback invoked when wallet state changes. */
export type DuskWalletSubscriber = (state: DuskWalletState) => void;

const EMPTY_PROVIDERS: DuskProviderInfo[] = [];
const PROVIDER_READ_METHODS = new Set([
  "dusk_getCapabilities", "dusk_chainId", "dusk_profiles", "dusk_getPublicBalance", "dusk_estimateGas",
]);

const initialState = (installed: boolean): DuskWalletState => ({
  installed,
  providerId: null,
  providerInfo: null,
  availableProviders: EMPTY_PROVIDERS,
  authorized: false,
  accounts: [],
  profiles: [],
  chainId: null,
  selectedAddress: null,
  selectedProfile: null,
  node: null,
  capabilities: null,
  lastUpdated: Date.now(),
});

function cloneProviderInfo(info: DuskProviderInfo): DuskProviderInfo {
  return {
    uuid: info.uuid,
    name: info.name,
    icon: info.icon,
    rdns: info.rdns,
  };
}

function cloneState(st: DuskWalletState): DuskWalletState {
  return {
    ...st,
    providerInfo: st.providerInfo ? cloneProviderInfo(st.providerInfo) : null,
    availableProviders: st.availableProviders.map(cloneProviderInfo),
    accounts: [...st.accounts],
    profiles: st.profiles.map((profile) => ({ ...profile })),
    selectedProfile: st.selectedProfile ? { ...st.selectedProfile } : null,
    node: st.node ? { ...st.node } : null,
  };
}

function shallowArrayEq(a: readonly unknown[], b: readonly unknown[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function providerInfoEq(a: DuskProviderInfo | null, b: DuskProviderInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.uuid === b.uuid && a.name === b.name && a.icon === b.icon && a.rdns === b.rdns;
}

function providerInfoArrayEq(a: readonly DuskProviderInfo[], b: readonly DuskProviderInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!providerInfoEq(a[i] ?? null, b[i] ?? null)) return false;
  }
  return true;
}

function translateProviderError(err: unknown): RpcErrorLike {
  const e = normalizeError(err);
  switch (e.code) {
    case ERROR_CODES.UNSUPPORTED:
      return new DuskWalletUnsupportedMethodError(e.message);
    case ERROR_CODES.DISCONNECTED:
      return new DuskWalletDisconnectedError(e.message);
    case ERROR_CODES.UNAUTHORIZED:
      return new DuskWalletUnauthorizedError(e.message);
    case ERROR_CODES.USER_REJECTED:
      return new DuskWalletUserRejectedError(e.message);
    default:
      return e;
  }
}

/**
 * Wrapper around a discovered Dusk provider with a small reactive state store.
 */
export class DuskWallet {
  private _provider: DuskProvider | null = null;
  private _state: DuskWalletState = initialState(false);
  private _subs = new Set<DuskWalletSubscriber>();
  private _providers = new Map<string, DuskProviderDetail>();
  private _boundProvider: DuskProvider | null = null;
  private _boundEvents: Array<[keyof DuskProviderEventMap, (payload: any) => void]> = [];
  private _destroyed = false;
  private _readyPromise: Promise<void>;
  private readonly _providerReadTimeoutMs: number;
  private _stopDiscovery: (() => void) | null = null;
  private _explicitProvider = false;
  private _rememberLastUsed = true;
  private _providerStorageKey = DUSK_SELECTED_PROVIDER_STORAGE_KEY;
  private _preferredProviderId: string | null = null;
  private _preferredProviderRdns: string | null = null;
  private _readySettled = false;
  private _selectionEpoch = 0;
  private _sessionEpoch = 0;
  private _profilesEpoch = 0;
  private _connectionIntent = 0;
  private _networkEpoch = 0;
  private _refreshing: {
    provider: DuskProvider;
    epoch: number;
    sessionEpoch: number;
    profilesEpoch: number;
    networkEpoch: number;
    promise: Promise<{ state: DuskWalletState; profilesEpoch: number }>;
  } | null = null;
  private _appEventHandlers = new Map<keyof DuskProviderEventMap, Set<(payload: any) => void>>();

  private _profilesFrom(value: unknown): DuskProfile[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const raw = item as Partial<DuskProfile>;
        const account = typeof raw.account === "string" ? raw.account.trim() : "";
        if (!account) return null;
        const shieldedAddress =
          typeof raw.shieldedAddress === "string" && raw.shieldedAddress.trim()
            ? raw.shieldedAddress.trim()
            : undefined;
        const previous = this._state.profiles.find((profile) => profile.account === account);
        return {
          profileId:
            typeof raw.profileId === "string" && raw.profileId.trim()
              ? raw.profileId.trim()
              : (previous?.profileId ?? `profile:${index}`),
          account,
          ...(shieldedAddress ? { shieldedAddress } : {}),
        };
      })
      .filter(Boolean) as DuskProfile[];
  }

  private _setProfiles(value: unknown, opts: { notify?: boolean } = {}) {
    const profiles = this._profilesFrom(value);
    const accounts = profiles.map((profile) => profile.account);
    const selectedProfile = profiles[0] ?? null;
    const selectedAddress = accounts[0] ?? null;
    const sameProfiles = JSON.stringify(this._state.profiles) === JSON.stringify(profiles);
    const sameAccounts = shallowArrayEq(this._state.accounts, accounts);
    const sameSelectedProfile =
      JSON.stringify(this._state.selectedProfile ?? null) === JSON.stringify(selectedProfile ?? null);
    if (sameProfiles && sameAccounts && sameSelectedProfile && this._state.selectedAddress === selectedAddress) return;
    this._patch(
      {
        profiles,
        accounts,
        selectedProfile,
        selectedAddress,
      },
      opts
    );
  }

  private _setDisconnected() {
    if (
      !this._state.authorized &&
      this._state.accounts.length === 0 &&
      this._state.profiles.length === 0 &&
      this._state.selectedAddress === null &&
      this._state.selectedProfile === null
    )
      return;
    this._patch({ authorized: false, accounts: [], profiles: [], selectedAddress: null, selectedProfile: null });
  }

  private _hydrateFromProvider(p: DuskProvider, opts: { notify?: boolean } = {}) {
    this._patch(
      {
        installed: this._providers.size > 0 || Boolean(this._provider),
        chainId: p.chainId ?? this._state.chainId,
        authorized: p.isAuthorized === true,
      },
      opts
    );
    if (Array.isArray(p.profiles)) {
      this._setProfiles(p.profiles, { notify: false });
    }
  }

  private _onConnect = () => {
    if (!this._provider) return;
    // The event is a hint, not a permission grant or authoritative chain snapshot.
    this._hydrateFromProvider(this._provider, { notify: false });
    this._notify();
    void this.refresh().catch(() => {});
  };

  private _onDisconnect = (_payload: DuskProviderEventMap["disconnect"]) => {
    this._sessionEpoch++;
    this._setDisconnected();
  };

  private _onProfilesChanged = (profiles: DuskProviderEventMap["profilesChanged"]) => {
    // A locked provider may clear profiles without revoking site permission.
    if (
      Array.isArray(profiles) && profiles.length === 0 &&
      (this._state.authorized || this._provider?.isAuthorized === true)
    ) {
      this._sessionEpoch++;
    }
    this._setProfiles(profiles);
  };

  private _onChainChanged = (chainId: DuskProviderEventMap["chainChanged"]) => {
    if (typeof chainId === "string" && chainId !== this._state.chainId) {
      this._patch({ chainId });
    }
  };

  private _onNodeChanged = (payload: DuskProviderEventMap["duskNodeChanged"]) => {
    if (payload && typeof payload === "object") {
      this._patch({ node: payload as any, chainId: (payload as any).chainId ?? this._state.chainId });
    }
  };

  private _events: Array<[keyof DuskProviderEventMap, (payload: any) => void]> = [
    ["connect", this._onConnect],
    ["disconnect", this._onDisconnect],
    ["profilesChanged", this._onProfilesChanged],
    ["chainChanged", this._onChainChanged],
    ["duskNodeChanged", this._onNodeChanged],
  ];

  constructor(opts: DuskWalletOptions = {}) {
    this._providerReadTimeoutMs = opts.providerReadTimeoutMs === undefined ? 10_000 : opts.providerReadTimeoutMs;
    if (!Number.isInteger(this._providerReadTimeoutMs) || this._providerReadTimeoutMs <= 0 || this._providerReadTimeoutMs > 2_147_483_647) {
      throw new TypeError("providerReadTimeoutMs must be an integer between 1 and 2147483647");
    }
    this._explicitProvider = Boolean(opts.provider);
    this._rememberLastUsed = opts.rememberLastUsedProvider !== false;
    this._providerStorageKey = opts.providerStorageKey || DUSK_SELECTED_PROVIDER_STORAGE_KEY;
    this._preferredProviderId = (opts.preferredProviderId && String(opts.preferredProviderId).trim()) || null;
    if (!this._explicitProvider && !this._preferredProviderId && this._rememberLastUsed) {
      const stored = this._readStoredProvider();
      this._preferredProviderId = stored?.uuid ?? null;
      this._preferredProviderRdns = stored?.rdns ?? null;
    }

    this._state = initialState(false);
    // Register before subscribing: its initial request elicits synchronous announcements.
    if (opts.provider && isDuskProvider(opts.provider)) {
      this._provider = opts.provider;
      this._registerExplicitProvider(opts.provider, opts.providerInfo ?? null, { notify: false, persist: false });
    }

    this._stopDiscovery = subscribeDuskProviders((detail) => {
      if (!this._registerDiscoveredProvider(detail, { notify: false })) return;
      if (this._readySettled && !this._provider && !this._explicitProvider) {
        this._autoSelectDiscoveredProvider({ notify: false });
      }
      this._notify();
    });

    this._readyPromise = (async () => {
      if (!this._provider) {
        const details =
          opts.waitForProvider !== false
            ? await waitForDuskProviders(opts.providerWaitOptions)
            : await requestDuskProviders({ timeoutMs: 0 });

        if (this._destroyed) return;
        for (const detail of details) {
          this._registerDiscoveredProvider(detail, { notify: false });
        }

        this._autoSelectDiscoveredProvider({ notify: false });
      }

      if (this._provider) {
        this._bindProviderEvents();
        this._hydrateFromProvider(this._provider, { notify: false });
        if (opts.autoRefresh !== false) {
          await this.refresh().catch(error => {
            if (error instanceof DuskWalletRequestTimeoutError) throw error;
          });
        }
      } else {
        this._syncAvailableProviders({ notify: false });
      }
    })().finally(() => {
      this._readySettled = true;
      this._notify();
    });
    // Initialization starts eagerly; keep its rejection observable through ready()
    // without an unhandled rejection when the application has not awaited it yet.
    void this._readyPromise.catch(() => {});
  }

  private _availableProviderInfos(): DuskProviderInfo[] {
    return [...this._providers.values()]
      .map((detail) => cloneProviderInfo(detail.info))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private _syncAvailableProviders(opts: { notify?: boolean } = {}) {
    const availableProviders = this._availableProviderInfos();
    const installed = availableProviders.length > 0 || Boolean(this._provider);
    const changed =
      installed !== this._state.installed || !providerInfoArrayEq(this._state.availableProviders, availableProviders);
    if (!changed) return;
    this._patch({ installed, availableProviders }, opts);
  }

  private _registerExplicitProvider(
    provider: DuskProvider,
    providerInfo: DuskProviderInfo | null,
    opts: { notify?: boolean; persist?: boolean } = {}
  ) {
    if (providerInfo?.uuid) {
      registerDiscoveredProvider(this._providers, { info: cloneProviderInfo(providerInfo), provider });
      const detail = this._providers.get(providerInfo.uuid)!;
      this._applySelectedProvider(detail, opts);
      this._syncAvailableProviders({ notify: false });
      return;
    }

    this._provider = provider;
    this._patch(
      {
        installed: true,
        providerId: null,
        providerInfo: null,
        availableProviders: this._availableProviderInfos(),
        authorized: false,
        accounts: [],
        profiles: [],
        selectedAddress: null,
        selectedProfile: null,
        chainId: provider.chainId ?? null,
        node: null,
        capabilities: null,
      },
      { notify: false }
    );
    this._hydrateFromProvider(provider, { notify: false });
    this._syncAvailableProviders({ notify: false });
    if (opts.notify !== false) this._notify();
  }

  private _registerDiscoveredProvider(detail: DuskProviderDetail, opts: { notify?: boolean } = {}): boolean {
    if (!registerDiscoveredProvider(this._providers, detail)) return false;
    const retained = this._providers.get(detail.info.uuid)!;
    if (retained.provider === this._provider && !this._state.providerInfo) {
      this._patch({ providerInfo: cloneProviderInfo(retained.info) }, { notify: false });
    }
    this._syncAvailableProviders({ notify: false });

    if (opts.notify !== false) this._notify();
    return true;
  }

  private _readStoredProvider(): { uuid?: string; rdns?: string } | null {
    try {
      if (typeof localStorage === "undefined") return null;
      const value = localStorage.getItem(this._providerStorageKey)?.trim();
      if (!value) return null;
      try {
        const stored = JSON.parse(value);
        if (stored?.version === 1 && typeof stored.rdns === "string" && stored.rdns.trim()) {
          return { rdns: stored.rdns.trim().toLowerCase() };
        }
      } catch {
        // Not a structured preference; preserve the legacy raw ID below.
      }
      return { uuid: value };
    } catch {
      // Unavailable storage must not prevent discovery.
    }
    return null;
  }

  private _writeStoredProvider(info: DuskProviderInfo | null) {
    if (!this._rememberLastUsed) return;
    try {
      if (typeof localStorage === "undefined") return;
      if (info?.rdns) localStorage.setItem(this._providerStorageKey,
        JSON.stringify({ version: 1, rdns: info.rdns.trim().toLowerCase() }));
      else localStorage.removeItem(this._providerStorageKey);
    } catch {
      // ignore
    }
  }

  private _applySelectedProvider(
    detail: DuskProviderDetail | null,
    opts: { notify?: boolean; persist?: boolean } = {}
  ) {
    const nextProvider = detail?.provider ?? null;
    const nextInfo = detail ? cloneProviderInfo(detail.info) : null;
    const nextProviderId = nextInfo?.uuid ?? null;
    const sameProvider = this._provider === nextProvider;
    const sameInfo = providerInfoEq(this._state.providerInfo, nextInfo);

    if (!sameProvider) {
      this._unbindProviderEvents();
      this._provider = nextProvider;
      this._selectionEpoch++;
      if (this._provider) this._bindProviderEvents();
    }

    this._patch(
      sameProvider
        ? {
            installed: this._providers.size > 0 || Boolean(nextProvider),
            providerId: nextProviderId,
            providerInfo: nextInfo,
            availableProviders: this._availableProviderInfos(),
          }
        : {
            installed: this._providers.size > 0 || Boolean(nextProvider),
            providerId: nextProviderId,
            providerInfo: nextInfo,
            authorized: false,
            accounts: [],
            profiles: [],
            selectedAddress: null,
            selectedProfile: null,
            chainId: null, // Hydrate only after clearing the previous provider's chain.
            node: null,
            capabilities: null,
            availableProviders: this._availableProviderInfos(),
          },
      { notify: false }
    );

    if (nextProvider && !sameProvider) {
      this._hydrateFromProvider(nextProvider, { notify: false });
    }

    if (opts.persist !== false) {
      this._preferredProviderId = nextProviderId;
      this._preferredProviderRdns = null;
      this._writeStoredProvider(nextInfo);
    }

    if (opts.notify !== false && (!sameProvider || !sameInfo)) {
      this._notify();
    }
  }

  private _autoSelectDiscoveredProvider(opts: { notify?: boolean } = {}) {
    if (this._explicitProvider || this._provider) return;
    const providers = [...this._providers.values()];

    if (this._preferredProviderId || this._preferredProviderRdns) {
      const matches = providers.filter(detail => detail.info.rdns === this._preferredProviderRdns);
      const preferred = this._preferredProviderId
        ? this._providers.get(this._preferredProviderId)
        : matches.length === 1 ? matches[0] : undefined;
      if (preferred) {
        const applyOpts: { notify?: boolean; persist?: boolean } = { persist: false };
        if (opts.notify !== undefined) applyOpts.notify = opts.notify;
        this._applySelectedProvider(preferred, applyOpts);
      }
      return; // Never substitute another provider for an unmatched preference.
    }

    if (this._providers.size === 1) {
      const only = [...this._providers.values()][0] ?? null;
      if (only) {
        const applyOpts: { notify?: boolean; persist?: boolean } = { persist: false };
        if (opts.notify !== undefined) applyOpts.notify = opts.notify;
        this._applySelectedProvider(only, applyOpts);
      }
    }
  }

  private _getProvider(): DuskProvider | null {
    if (!this._provider) {
      this._autoSelectDiscoveredProvider({ notify: false });
    }
    return this._provider;
  }

  private _requireProvider(): DuskProvider {
    if (this._destroyed) throw new DuskWalletProviderChangedError("Dusk wallet has been destroyed");
    const p = this._getProvider();
    if (p) return p;
    if (this._state.availableProviders.length > 0) {
      throw new DuskWalletProviderSelectionError();
    }
    throw new DuskWalletNotInstalledError();
  }

  private _captureSelection(): { provider: DuskProvider; epoch: number } {
    return { provider: this._requireProvider(), epoch: this._selectionEpoch };
  }

  private _assertCurrentSelection(
    provider: DuskProvider, epoch: number, sessionEpoch?: number, profilesEpoch?: number
  ): void {
    if (this._destroyed || provider !== this._provider || epoch !== this._selectionEpoch) {
      throw new DuskWalletProviderChangedError();
    }
    if (
      (sessionEpoch !== undefined && sessionEpoch !== this._sessionEpoch) ||
      (profilesEpoch !== undefined && profilesEpoch !== this._profilesEpoch)
    ) {
      throw new DuskSdkError("Wallet session changed during request", { data: { reason: "session_changed" } });
    }
  }

  private async _requestProvider<T>(provider: DuskProvider, method: string, params?: unknown): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!PROVIDER_READ_METHODS.has(method)) return await provider.request<T>({ method, params });
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DuskWalletRequestTimeoutError(method, this._providerReadTimeoutMs)), this._providerReadTimeoutMs);
      });
      return await Promise.race([provider.request<T>({ method, params }), deadline]);
    } catch (err) {
      throw translateProviderError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private async _requestForSelection<T>(
    provider: DuskProvider,
    epoch: number,
    method: string,
    params?: unknown
  ): Promise<T> {
    try {
      const result = await this._requestProvider<T>(provider, method, params);
      this._assertCurrentSelection(provider, epoch);
      return result;
    } catch (error) {
      this._assertCurrentSelection(provider, epoch);
      throw error;
    }
  }

  private async _submitForSelection<T>(
    provider: DuskProvider,
    epoch: number,
    params: unknown
  ): Promise<T> {
    try {
      return await this._requestProvider<T>(provider, "dusk_sendTransaction", params);
    } catch (error) {
      this._assertCurrentSelection(provider, epoch);
      throw error;
    }
  }

  private _emitAppEvent<E extends keyof DuskProviderEventMap>(
    handlers: Array<(payload: DuskProviderEventMap[E]) => void>,
    payload: DuskProviderEventMap[E],
    provider: DuskProvider,
    epoch: number
  ): void {
    for (const handler of handlers) {
      if (this._provider !== provider || this._selectionEpoch !== epoch) return;
      try {
        handler(payload);
      } catch {
        // ignore application handler errors
      }
    }
  }

  /** Resolves after initial discovery/refresh; rejects if a provider read times out. Retry with refresh(). */
  async ready(): Promise<this> {
    await this._readyPromise;
    return this;
  }

  /** Whether initial discovery/refresh is pending; false after either success or failure. */
  get initializing(): boolean {
    return !this._readySettled;
  }

  /** The currently selected provider, if any. */
  get provider(): DuskProvider | null {
    return this._provider;
  }

  /** Monotonic generation of the selected provider. */
  get selectionEpoch(): number {
    return this._selectionEpoch;
  }

  /** Monotonic generation of the selected chain or node. */
  get networkEpoch(): number {
    return this._networkEpoch;
  }

  /** Metadata for the currently selected provider, if any. */
  get providerInfo(): DuskProviderInfo | null {
    return this._state.providerInfo ? cloneProviderInfo(this._state.providerInfo) : null;
  }

  /** All discovered wallet providers. */
  get providers(): DuskProviderInfo[] {
    return this._state.availableProviders.map(cloneProviderInfo);
  }

  /** Current reactive state (copy). */
  get state(): DuskWalletState {
    return cloneState(this._state);
  }

  /** Actively request wallet announcements and update the discovered provider list. */
  async discoverProviders(options: RequestDuskProvidersOptions = {}): Promise<DuskProviderInfo[]> {
    if (this._destroyed) throw new DuskWalletProviderChangedError("Dusk wallet has been destroyed");
    const details = await requestDuskProviders(options);
    if (this._destroyed) throw new DuskWalletProviderChangedError("Dusk wallet has been destroyed");
    for (const detail of details) {
      this._registerDiscoveredProvider(detail, { notify: false });
    }
    if (!this._provider && !this._explicitProvider) {
      this._autoSelectDiscoveredProvider({ notify: false });
    }
    this._notify();
    return this.providers;
  }

  /** Select one of the discovered providers by id. */
  async selectProvider(providerId: string): Promise<DuskWalletState> {
    if (this._destroyed) throw new DuskWalletProviderChangedError("Dusk wallet has been destroyed");
    const id = String(providerId || "").trim();
    if (!id) throw new DuskWalletProviderNotFoundError();

    let detail = this._providers.get(id);
    if (!detail) {
      await this.discoverProviders({ timeoutMs: 50 });
      detail = this._providers.get(id);
    }

    if (!detail) throw new DuskWalletProviderNotFoundError(`Unknown Dusk wallet provider: ${id}`);
    this._applySelectedProvider(detail, { notify: false });
    const { provider, epoch } = this._captureSelection();
    await this.refresh();
    this._notify();
    this._assertCurrentSelection(provider, epoch);
    return this.state;
  }

  /** Subscribe to state updates. Returns an unsubscribe function. */
  subscribe(fn: DuskWalletSubscriber): () => void {
    if (this._destroyed) return () => {};
    this._subs.add(fn);
    try {
      fn(this.state);
    } catch {
      // ignore
    }
    return () => {
      this._subs.delete(fn);
    };
  }

  /** Low-level request wrapper. */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const { provider, epoch } = this._captureSelection();
    return method === "dusk_sendTransaction"
      ? await this._submitForSelection<T>(provider, epoch, params)
      : await this._requestForSelection<T>(provider, epoch, method, params);
  }

  /**
   * Refresh capabilities, chain id, and approved profiles without prompting.
   * Overlapping refreshes share requests within the same provider/session/profile/network context.
   */
  async refresh(): Promise<DuskWalletState> {
    if (this._destroyed) throw new DuskWalletProviderChangedError("Dusk wallet has been destroyed");
    const p = this._getProvider();
    if (!p) {
      this._syncAvailableProviders({ notify: false });
      this._patch(
        {
          providerId: null,
          providerInfo: null,
          authorized: false,
          accounts: [],
          profiles: [],
          selectedAddress: null,
          selectedProfile: null,
          chainId: null,
          node: null,
          capabilities: null,
        },
        { notify: false }
      );
      this._notify();
      return this.state;
    }

    const epoch = this._selectionEpoch;
    const sessionEpoch = this._sessionEpoch;
    const profilesEpoch = this._profilesEpoch;
    const networkEpoch = this._networkEpoch;
    let pending = this._refreshing;
    if (
      !pending ||
      pending.provider !== p || pending.epoch !== epoch ||
      pending.sessionEpoch !== sessionEpoch || pending.profilesEpoch !== profilesEpoch ||
      pending.networkEpoch !== networkEpoch
    ) {
      let start!: () => void;
      const promise = new Promise<{ state: DuskWalletState; profilesEpoch: number }>((resolve, reject) => {
        start = () => {
          this._refreshState(p, epoch, sessionEpoch, profilesEpoch, networkEpoch).then(resolve, reject);
        };
      });
      // Register the refresh before provider calls can synchronously emit events.
      pending = this._refreshing = { provider: p, epoch, sessionEpoch, profilesEpoch, networkEpoch, promise };
      start();
    }
    try {
      const result = await pending.promise;
      // Publishing fresh profiles can advance the revision; validate the returned snapshot's revision.
      this._assertCurrentSelection(p, epoch, sessionEpoch, result.profilesEpoch);
      return cloneState(result.state);
    } finally {
      if (this._refreshing === pending) this._refreshing = null;
    }
  }

  private async _refreshState(
    p: DuskProvider,
    epoch: number,
    sessionEpoch: number,
    profilesEpoch: number,
    networkEpoch: number
  ): Promise<{ state: DuskWalletState; profilesEpoch: number }> {
    const optionalRead = (error: unknown) => {
      if (error instanceof DuskWalletRequestTimeoutError) {
        this._assertCurrentSelection(p, epoch, sessionEpoch, profilesEpoch);
        throw error;
      }
      return null;
    };
    const [caps, chainId, profiles] = await Promise.all([
      this._requestProvider<DuskProviderCapabilities>(p, "dusk_getCapabilities").catch(optionalRead),
      this._requestProvider<ChainId>(p, "dusk_chainId").catch(optionalRead),
      this._requestProvider<DuskProfile[]>(p, "dusk_profiles").catch(optionalRead),
    ]);
    this._assertCurrentSelection(p, epoch, sessionEpoch, profilesEpoch);
    if (networkEpoch !== this._networkEpoch) {
      throw new DuskSdkError("Wallet network changed during refresh", { data: { reason: "network_changed" } });
    }

    const nextChainId = typeof chainId === "string"
      ? chainId
      : typeof caps?.chainId === "string"
        ? caps.chainId
        : p.chainId ?? null;
    const nextNode = caps
      ? {
          chainId: nextChainId ?? caps.chainId,
          nodeUrl: caps.nodeUrl,
          networkName: caps.networkName,
        }
      : this._state.node;
    this._patch(
      {
        chainId: nextChainId,
        node: nextNode,
        capabilities: caps,
        authorized: p.isAuthorized === true,
      },
      { notify: false }
    );
    this._setProfiles(profiles, { notify: false });
    this._notify();

    return { state: this._state, profilesEpoch: this._profilesEpoch };
  }

  /** Prompt the user to connect (permission grant). */
  async connect(options?: ConnectOptions): Promise<DuskProfile[]> {
    return await this.requestProfiles(options);
  }

  /** Prompt the user to connect and return approved profile pairs. */
  async requestProfiles(options?: ConnectOptions): Promise<DuskProfile[]> {
    const { provider, epoch } = this._captureSelection();
    this._connectionIntent++;
    const sessionEpoch = this._sessionEpoch;
    const params = options && Object.keys(options).length > 0 ? options : undefined;
    const profilesRaw = await this._requestForSelection<DuskProfile[]>(
      provider,
      epoch,
      "dusk_requestProfiles",
      params
    );
    this._assertCurrentSelection(provider, epoch, sessionEpoch);
    const profiles = this._profilesFrom(profilesRaw);

    this._patch({ authorized: true, chainId: this._provider?.chainId ?? this._state.chainId }, { notify: false });
    this._setProfiles(profiles, { notify: false });
    this._notify();
    this._assertCurrentSelection(provider, epoch, sessionEpoch);

    return profiles;
  }

  /** Revoke the site's connection permission. */
  async disconnect(): Promise<boolean> {
    const { provider, epoch } = this._captureSelection();
    // Discard older reads as soon as revocation is requested, even if the RPC
    // later fails. Do not let its delayed completion clear a newer connection.
    const sessionEpoch = ++this._sessionEpoch;
    const connectionIntent = this._connectionIntent;
    const res = await this._requestForSelection<boolean>(provider, epoch, "dusk_disconnect");
    this._assertCurrentSelection(provider, epoch);
    if (sessionEpoch === this._sessionEpoch && connectionIntent === this._connectionIntent) {
      this._setDisconnected();
    }
    this._assertCurrentSelection(provider, epoch);
    return Boolean(res);
  }

  async getProfiles(): Promise<DuskProfile[]> {
    const { provider, epoch } = this._captureSelection();
    const sessionEpoch = this._sessionEpoch;
    const profiles = await this._requestForSelection<DuskProfile[]>(provider, epoch, "dusk_profiles");
    this._assertCurrentSelection(provider, epoch, sessionEpoch);
    const next = this._profilesFrom(profiles);
    this._setProfiles(next, { notify: false });
    this._notify();
    this._assertCurrentSelection(provider, epoch, sessionEpoch);
    return next;
  }

  async getAccounts(): Promise<AccountId[]> {
    const profiles = await this.getProfiles();
    return profiles.map((profile) => profile.account);
  }

  async getChainId(): Promise<ChainId> {
    return await this.request<ChainId>("dusk_chainId");
  }

  /** Request the wallet to switch its selected chain (prompts user). */
  async switchChain(params: SwitchChainParams): Promise<null> {
    return await this.request<null>("dusk_switchNetwork", [params]);
  }

  async getPublicBalance(): Promise<BalanceResult> {
    return await this.request<BalanceResult>("dusk_getPublicBalance");
  }

  /**
   * Prompt the wallet to reveal a shareable shielded receive address.
   *
   * Receive addresses are useful for payment links but should only be
   * disclosed after explicit user intent.
   */
  async requestShieldedAddress(params: RequestShieldedAddressParams = {}): Promise<Address> {
    const { provider, epoch } = this._captureSelection();
    const sessionEpoch = this._sessionEpoch;
    const result = await this._requestForSelection<RequestShieldedAddressResponse>(
      provider,
      epoch,
      "dusk_requestShieldedAddress",
      params
    );
    this._assertCurrentSelection(provider, epoch, sessionEpoch);
    const address = typeof result === "string" ? result : result?.address;
    const trimmed = typeof address === "string" ? address.trim() : "";
    if (!trimmed) {
      throw new Error("Wallet did not return a shielded receive address");
    }

    const profileId =
      typeof result === "object" && result && typeof result.profileId === "string"
        ? result.profileId.trim()
        : "";
    const account =
      typeof result === "object" && result && typeof result.account === "string"
        ? result.account.trim()
        : (params.account ?? this._state.selectedProfile?.account ?? "");
    const resultChainId =
      typeof result === "object" && result && typeof result.chainId === "string" && result.chainId.trim()
        ? result.chainId.trim()
        : "";
    if (profileId || account) {
      let matched = false;
      const profiles = this._state.profiles.length
        ? this._state.profiles.map((profile, index) => {
            const isMatch = profileId ? profile.profileId === profileId : profile.account === account;
            if (isMatch) matched = true;
            return isMatch
              ? { ...profile, shieldedAddress: trimmed }
              : { ...profile, profileId: profile.profileId || `profile:${index}` };
          })
        : [
            {
              profileId: profileId || this._state.selectedProfile?.profileId || `account:0:${account}`,
              account,
              shieldedAddress: trimmed,
            },
          ];
      const nextProfiles =
        this._state.profiles.length > 0 && !matched && account
          ? [...profiles, { profileId: profileId || `account:${profiles.length}:${account}`, account, shieldedAddress: trimmed }]
          : profiles;
      this._patch(
        {
          authorized: true,
          chainId: resultChainId || this._state.chainId,
        },
        { notify: false }
      );
      this._setProfiles(nextProfiles, { notify: false });
      this._notify();
    }

    this._assertCurrentSelection(provider, epoch, sessionEpoch);
    return trimmed;
  }

  /** Fetch current gas price stats from the node mempool. */
  async getGasPrice(opts?: { maxTransactions?: number }): Promise<GasPriceResult> {
    return await this.request<GasPriceResult>("dusk_estimateGas", opts ?? {});
  }

  async getCapabilities(): Promise<DuskProviderCapabilities> {
    return await this.request<DuskProviderCapabilities>("dusk_getCapabilities");
  }

  async signMessage(message: ByteLike): Promise<SignMessageResult> {
    return await this.request<SignMessageResult>("dusk_signMessage", { message });
  }

  async signAuth(params: SignAuthParams): Promise<SignAuthResult> {
    return await this.request<SignAuthResult>("dusk_signAuth", params);
  }

  async sendTransaction(params: SendTransactionParams): Promise<TxResult> {
    const { provider, epoch } = this._captureSelection();
    return await this._submitForSelection<TxResult>(provider, epoch, this._normalizeTransactionParams(params));
  }

  async sendTransfer(params: Omit<Extract<SendTransactionParams, { kind: "transfer" }>, "kind">): Promise<TxResult> {
    return await this.sendTransaction({ kind: "transfer", ...params });
  }

  async sendContractCall(
    params: Omit<Extract<SendTransactionParams, { kind: "contract_call" }>, "kind">
  ): Promise<TxResult> {
    return await this.sendTransaction({ kind: "contract_call", ...params });
  }

  private _normalizeTransactionParams(params: SendTransactionParams): SendTransactionParams {
    if ((params as any)?.kind === "transfer") {
      const input = params as Extract<SendTransactionParams, { kind: "transfer" }>;
      const privacy = String((input as any).privacy ?? "").trim();
      if (!privacy) {
        throw new TypeError('privacy is required ("public" or "shielded")');
      }
      if (privacy !== "public" && privacy !== "shielded") {
        throw new TypeError('privacy must be "public" or "shielded"');
      }

      return {
        ...input,
        privacy,
      };
    }

    if ((params as any)?.kind !== "contract_call") return params;

    const input = params as Extract<SendTransactionParams, { kind: "contract_call" }>;
    const fnName = String(input.fnName ?? "").trim();
    if (!fnName) throw new TypeError("fnName is required");

    const privacy = String((input as any).privacy ?? "").trim();
    if (!privacy) {
      throw new TypeError('privacy is required ("public" or "shielded")');
    }
    if (privacy !== "public" && privacy !== "shielded") {
      throw new TypeError('privacy must be "public" or "shielded"');
    }

    return {
      ...input,
      privacy,
      contractId: normalizeContractId0x(input.contractId),
      fnName,
      fnArgs: "0x" + bytesToHex(toBytes(input.fnArgs)).toLowerCase(),
    };
  }

  /**
   * Prompt the user to add a standard token/NFT contract to the wallet UI.
   *
   * NOTE: the wallet requires prior profile connection permission.
   * This helper can optionally auto-connect first (default: true).
   */
  async watchAsset(params: WatchAssetParams, opts: { autoConnect?: boolean } = {}): Promise<boolean> {
    const { provider, epoch } = this._captureSelection();
    const autoConnect = opts.autoConnect ?? true;
    if (autoConnect && !this._state.authorized) {
      await this.connect();
      this._assertCurrentSelection(provider, epoch);
    }

    const typeRaw = String((params as any)?.type ?? "").trim();
    const type = typeRaw.toUpperCase();
    const optionsIn: any = (params as any)?.options ?? {};

    const contractId = normalizeContractId0x(optionsIn.contractId);

    const out: any = {
      type,
      options: {
        ...optionsIn,
        contractId,
      },
    };

    if (type === "DRC721") {
      const tid = optionsIn.tokenId;
      out.options.tokenId = typeof tid === "bigint" ? tid.toString() : String(tid ?? "").trim();
    }

    return await this._requestForSelection<boolean>(provider, epoch, "dusk_watchAsset", out);
  }

  /** Proxy provider events (typed). Returns an unsubscribe function. */
  on<E extends keyof DuskProviderEventMap>(
    eventName: E,
    handler: (payload: DuskProviderEventMap[E]) => void
  ): () => void {
    if (this._destroyed) return () => {};
    const handlers = this._appEventHandlers.get(eventName) ?? new Set();
    handlers.add(handler as any);
    this._appEventHandlers.set(eventName, handlers);
    return () => handlers.delete(handler as any);
  }

  /** Stop listening and free resources. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._selectionEpoch++;
    this._stopDiscovery?.();
    this._stopDiscovery = null;
    this._unbindProviderEvents();
    this._subs.clear();
    this._appEventHandlers.clear();
  }

  private _bindProviderEvents() {
    const provider = this._provider;
    if (this._boundProvider || !provider) return;
    const epoch = this._selectionEpoch;
    this._boundProvider = provider;
    this._boundEvents = this._events.map(([name, handler]) => [
      name,
      (payload: any) => {
        if (this._destroyed || this._provider !== provider || this._selectionEpoch !== epoch) return;
        const appHandlers = [...(this._appEventHandlers.get(name) ?? [])];
        handler(payload);
        if (this._provider === provider && this._selectionEpoch === epoch) {
          this._emitAppEvent(appHandlers, payload, provider, epoch);
        }
      },
    ]);
    for (const [name, handler] of this._boundEvents) provider.on(name as string, handler as any);
  }

  private _unbindProviderEvents() {
    if (!this._boundProvider) return;
    for (const [name, handler] of this._boundEvents) {
      this._boundProvider.off(name as string, handler as any);
    }
    this._boundProvider = null;
    this._boundEvents = [];
  }

  private _patch(partial: Partial<DuskWalletState>, opts: { notify?: boolean } = {}) {
    // Validate at the shared state boundary: RPCs, properties and events are all untrusted.
    if (partial.chainId !== null && typeof partial.chainId !== "string") delete partial.chainId;
    if (partial.node != null) {
      const nodeUrl = normalizeNodeUrl(partial.node.nodeUrl);
      partial.node = nodeUrl && typeof partial.node.chainId === "string"
        ? { chainId: partial.node.chainId, nodeUrl, networkName: typeof partial.node.networkName === "string" ? partial.node.networkName : "" }
        : null;
    }
    // _setProfiles preserves the array for equivalent profile lists.
    if (
      (partial.authorized !== undefined && partial.authorized !== this._state.authorized) ||
      (partial.profiles !== undefined && partial.profiles !== this._state.profiles)
    ) {
      this._profilesEpoch++;
    }
    const chainId = partial.chainId !== undefined ? partial.chainId : this._state.chainId;
    const nodeUrl = normalizeBaseUrl(
      partial.node !== undefined ? partial.node?.nodeUrl ?? "" : this._state.node?.nodeUrl ?? ""
    );
    if (chainId !== this._state.chainId || nodeUrl !== normalizeBaseUrl(this._state.node?.nodeUrl ?? "")) {
      this._networkEpoch++;
    }
    this._state = { ...this._state, ...partial, lastUpdated: Date.now() };
    if (opts.notify !== false) this._notify();
  }

  private _notify() {
    if (this._destroyed) return;
    const snapshot = this.state;
    for (const fn of this._subs) {
      try {
        fn(snapshot);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Create a {@link DuskWallet} instance.
 *
 * Use this when you only need wallet discovery, connection state, balances,
 * and transaction sending.
 */
export function createDuskWallet(opts?: DuskWalletOptions): DuskWallet {
  return new DuskWallet(opts);
}
