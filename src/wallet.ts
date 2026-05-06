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
  DuskWalletDisconnectedError,
  DuskWalletNotInstalledError,
  DuskWalletProviderNotFoundError,
  DuskWalletProviderSelectionError,
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
  requestDuskProviders,
  subscribeDuskProviders,
  waitForDuskProviders,
  type RequestDuskProvidersOptions,
  type WaitForDuskProvidersOptions,
} from "./discovery.js";

import { normalizeContractId0x } from "./internal/contractId.js";
import { bytesToHex, toBytes } from "./bytes.js";

export type WaitForProviderOptions = WaitForDuskProvidersOptions;

export type DuskWalletOptions = {
  /** Provide a provider explicitly (useful for tests or custom integrations). */
  provider?: DuskProvider | null;

  /** Metadata for an explicitly provided provider. */
  providerInfo?: DuskProviderInfo | null;

  /** Preferred wallet id to auto-select when multiple providers are discovered. */
  preferredProviderId?: string | null;

  /** If no provider is selected synchronously, wait briefly for discovery. Default: true. */
  waitForProvider?: boolean;

  /** Discovery polling options (only used if `waitForProvider !== false`). */
  providerWaitOptions?: WaitForProviderOptions;

  /** Immediately fetch `dusk_chainId` and `dusk_profiles` on init. Default: true. */
  autoRefresh?: boolean;

  /** Persist and restore the last selected provider. Default: true. */
  rememberLastUsedProvider?: boolean;

  /** localStorage key used for provider persistence. */
  providerStorageKey?: string;
};

export type DuskWalletSubscriber = (state: DuskWalletState) => void;

const EMPTY_PROVIDERS: DuskProviderInfo[] = [];

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
  private _bound = false;
  private _destroyed = false;
  private _readyPromise: Promise<void>;
  private _stopDiscovery: (() => void) | null = null;
  private _explicitProvider = false;
  private _rememberLastUsed = true;
  private _providerStorageKey = DUSK_SELECTED_PROVIDER_STORAGE_KEY;
  private _preferredProviderId: string | null = null;
  private _readySettled = false;

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
        authorized: Boolean(p.isAuthorized),
      },
      opts
    );
    if (Array.isArray(p.profiles)) {
      this._setProfiles(p.profiles, { notify: false });
    }
  }

  private _onConnect = (payload: DuskProviderEventMap["connect"]) => {
    const nextChainId = payload?.chainId ?? this._provider?.chainId ?? null;
    if (this._state.authorized && this._state.chainId === nextChainId) return;
    this._patch({ authorized: true, chainId: nextChainId });
  };

  private _onDisconnect = (_payload: DuskProviderEventMap["disconnect"]) => {
    this._setDisconnected();
  };

  private _onProfilesChanged = (profiles: DuskProviderEventMap["profilesChanged"]) => {
    this._setProfiles(profiles);
  };

  private _onChainChanged = (chainId: DuskProviderEventMap["chainChanged"]) => {
    if (typeof chainId !== "string" || chainId === this._state.chainId) return;
    this._patch({ chainId });
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
    this._explicitProvider = Boolean(opts.provider);
    this._rememberLastUsed = opts.rememberLastUsedProvider !== false;
    this._providerStorageKey = opts.providerStorageKey || DUSK_SELECTED_PROVIDER_STORAGE_KEY;
    this._preferredProviderId =
      (opts.preferredProviderId && String(opts.preferredProviderId).trim()) ||
      (this._rememberLastUsed ? this._readStoredProviderId() : null);

    this._state = initialState(false);
    this._stopDiscovery = subscribeDuskProviders((detail) => {
      this._registerDiscoveredProvider(detail, { notify: false });
      if (this._readySettled && !this._provider && !this._explicitProvider) {
        this._autoSelectDiscoveredProvider({ notify: false });
      }
      this._notify();
    });

    if (opts.provider && isDuskProvider(opts.provider)) {
      this._provider = opts.provider;
      this._registerExplicitProvider(opts.provider, opts.providerInfo ?? null, { notify: false, persist: false });
    }

    this._readyPromise = (async () => {
      if (!this._provider) {
        const details =
          opts.waitForProvider !== false
            ? await waitForDuskProviders(opts.providerWaitOptions)
            : await requestDuskProviders({ timeoutMs: 0 });

        for (const detail of details) {
          this._registerDiscoveredProvider(detail, { notify: false });
        }

        this._autoSelectDiscoveredProvider({ notify: false });
      }

      if (this._provider) {
        this._bindProviderEvents();
        this._hydrateFromProvider(this._provider, { notify: false });
        if (opts.autoRefresh !== false) {
          await this.refresh().catch(() => {});
        }
      } else {
        this._syncAvailableProviders({ notify: false });
      }

      this._readySettled = true;
      this._notify();
    })();
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
      this._providers.set(providerInfo.uuid, { info: cloneProviderInfo(providerInfo), provider });
      this._applySelectedProvider({ info: providerInfo, provider }, opts);
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
    const info = cloneProviderInfo(detail.info);
    const current = this._providers.get(info.uuid);
    const same = current && current.provider === detail.provider && providerInfoEq(current.info, info);
    if (same) return false;

    this._providers.set(info.uuid, { info, provider: detail.provider });
    this._syncAvailableProviders({ notify: false });

    if (this._state.providerId === info.uuid && this._provider !== detail.provider) {
      this._applySelectedProvider({ info, provider: detail.provider }, { notify: false, persist: false });
    }

    if (opts.notify !== false) this._notify();
    return true;
  }

  private _readStoredProviderId(): string | null {
    if (!this._rememberLastUsed || typeof localStorage === "undefined") return null;
    try {
      const value = localStorage.getItem(this._providerStorageKey);
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed || null;
    } catch {
      return null;
    }
  }

  private _writeStoredProviderId(providerId: string | null) {
    if (!this._rememberLastUsed || typeof localStorage === "undefined") return;
    try {
      if (providerId) localStorage.setItem(this._providerStorageKey, providerId);
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
      if (this._provider) this._bindProviderEvents();
    }

    this._patch(
      {
        installed: this._providers.size > 0 || Boolean(nextProvider),
        providerId: nextProviderId,
        providerInfo: nextInfo,
        authorized: false,
        accounts: [],
        profiles: [],
        selectedAddress: null,
        selectedProfile: null,
        chainId: nextProvider?.chainId ?? null,
        node: null,
        capabilities: null,
        availableProviders: this._availableProviderInfos(),
      },
      { notify: false }
    );

    if (nextProvider) {
      this._hydrateFromProvider(nextProvider, { notify: false });
    }

    if (opts.persist !== false) {
      this._preferredProviderId = nextProviderId;
      this._writeStoredProviderId(nextProviderId);
    }

    if (opts.notify !== false && (!sameProvider || !sameInfo)) {
      this._notify();
    }
  }

  private _autoSelectDiscoveredProvider(opts: { notify?: boolean } = {}) {
    if (this._explicitProvider || this._provider) return;

    if (this._preferredProviderId) {
      const preferred = this._providers.get(this._preferredProviderId);
      if (preferred) {
        const applyOpts: { notify?: boolean; persist?: boolean } = { persist: false };
        if (opts.notify !== undefined) applyOpts.notify = opts.notify;
        this._applySelectedProvider(preferred, applyOpts);
        return;
      }
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
    const p = this._getProvider();
    if (p) return p;
    if (this._state.availableProviders.length > 0) {
      throw new DuskWalletProviderSelectionError();
    }
    throw new DuskWalletNotInstalledError();
  }

  /** Resolves once initial provider discovery/refresh finished. */
  async ready(): Promise<this> {
    await this._readyPromise;
    return this;
  }

  /** The currently selected provider, if any. */
  get provider(): DuskProvider | null {
    return this._provider;
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
    const details = await requestDuskProviders(options);
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
    const id = String(providerId || "").trim();
    if (!id) throw new DuskWalletProviderNotFoundError();

    let detail = this._providers.get(id);
    if (!detail) {
      await this.discoverProviders({ timeoutMs: 50 });
      detail = this._providers.get(id);
    }

    if (!detail) throw new DuskWalletProviderNotFoundError(`Unknown Dusk wallet provider: ${id}`);

    this._applySelectedProvider(detail, { notify: false });
    if (this._provider) {
      await this.refresh().catch(() => {});
    }
    this._notify();
    return this.state;
  }

  /** Subscribe to state updates. Returns an unsubscribe function. */
  subscribe(fn: DuskWalletSubscriber): () => void {
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
    const p = this._requireProvider();
    try {
      return await p.request<T>({ method, params });
    } catch (err) {
      throw translateProviderError(err);
    }
  }

  /** Refresh capabilities, chain id, and approved profiles without prompting. */
  async refresh(): Promise<DuskWalletState> {
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

    const [caps, chainId, profiles] = await Promise.all([
      this.request<DuskProviderCapabilities>("dusk_getCapabilities").catch(() => null),
      this.request<ChainId>("dusk_chainId").catch(() => p.chainId ?? null),
      this.request<DuskProfile[]>("dusk_profiles").catch(() => []),
    ]);

    const nextChainId = typeof chainId === "string" ? chainId : p.chainId ?? null;
    this._patch(
      {
        chainId: nextChainId,
        capabilities: caps,
        authorized: Boolean(p.isAuthorized),
      },
      { notify: false }
    );
    this._setProfiles(profiles, { notify: false });
    this._notify();

    return this.state;
  }

  /** Prompt the user to connect (permission grant). */
  async connect(options?: ConnectOptions): Promise<DuskProfile[]> {
    return await this.requestProfiles(options);
  }

  /** Prompt the user to connect and return approved profile pairs. */
  async requestProfiles(options?: ConnectOptions): Promise<DuskProfile[]> {
    const params = options && Object.keys(options).length > 0 ? options : undefined;
    const profilesRaw = await this.request<DuskProfile[]>("dusk_requestProfiles", params);
    const profiles = this._profilesFrom(profilesRaw);

    this._patch({ authorized: true, chainId: this._provider?.chainId ?? this._state.chainId }, { notify: false });
    this._setProfiles(profiles, { notify: false });
    this._notify();

    return profiles;
  }

  /** Revoke the site's connection permission. */
  async disconnect(): Promise<boolean> {
    const res = await this.request<boolean>("dusk_disconnect");
    this._setDisconnected();
    return Boolean(res);
  }

  async getProfiles(): Promise<DuskProfile[]> {
    const profiles = await this.request<DuskProfile[]>("dusk_profiles");
    const next = this._profilesFrom(profiles);
    this._setProfiles(next, { notify: false });
    this._notify();
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
    const result = await this.request<RequestShieldedAddressResponse>("dusk_requestShieldedAddress", params);
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
    return await this.request<TxResult>("dusk_sendTransaction", this._normalizeTransactionParams(params));
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
    const autoConnect = opts.autoConnect ?? true;
    if (autoConnect && !this._state.authorized) {
      await this.connect();
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

    return await this.request<boolean>("dusk_watchAsset", out);
  }

  /** Proxy provider events (typed). Returns an unsubscribe function. */
  on<E extends keyof DuskProviderEventMap>(
    eventName: E,
    handler: (payload: DuskProviderEventMap[E]) => void
  ): () => void {
    const p = this._getProvider();
    if (!p) return () => {};
    p.on(eventName as string, handler as any);
    return () => p.off(eventName as string, handler as any);
  }

  /** Stop listening and free resources. */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._stopDiscovery?.();
    this._stopDiscovery = null;
    this._unbindProviderEvents();
    this._subs.clear();
  }

  private _bindProviderEvents() {
    if (this._bound || !this._provider) return;
    this._bound = true;
    for (const [name, fn] of this._events) this._provider.on(name as string, fn as any);
  }

  private _unbindProviderEvents() {
    if (!this._bound || !this._provider) return;
    this._bound = false;
    for (const [name, fn] of this._events) this._provider.off(name as string, fn as any);
  }

  private _patch(partial: Partial<DuskWalletState>, opts: { notify?: boolean } = {}) {
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
