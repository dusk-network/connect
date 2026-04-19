import { createDuskWallet } from "./wallet.js";

import type {
  AccountId,
  BalanceResult,
  ChainId,
  DuskNodeChangedPayload,
  DuskProviderCapabilities,
  DuskProviderInfo,
  DuskWalletState,
  SwitchChainParams,
} from "./types.js";

export type WalletConformanceCleanup =
  | void
  | (() => void | Promise<void>)
  | {
      cleanup?: () => void | Promise<void>;
    };

export type InstallWalletForConformance = (
  target: Window
) => WalletConformanceCleanup | Promise<WalletConformanceCleanup>;

export type WalletConformanceSwitchExpectation = {
  params: SwitchChainParams;
  expectedChainId?: ChainId;
  expectedNode?: Partial<DuskNodeChangedPayload>;
};

export type WalletConformanceOptions = {
  installWallet: InstallWalletForConformance;
  preferredProviderId?: string | null;
  expectedProvider?: Partial<Pick<DuskProviderInfo, "uuid" | "name" | "rdns">>;
  expectedAccount?: AccountId;
  expectedChainId?: ChainId;
  requestBalance?: boolean;
  switchChain?: WalletConformanceSwitchExpectation;
};

export type WalletConformanceReport = {
  initialState: DuskWalletState;
  connectedAccounts: AccountId[];
  capabilities: DuskProviderCapabilities;
  balance: BalanceResult | null;
  events: {
    accountsChanged: AccountId[][];
    chainChanged: ChainId[];
    nodeChanged: DuskNodeChangedPayload[];
  };
  afterSwitch: {
    chainId: ChainId | null;
    node: DuskNodeChangedPayload | null;
  } | null;
};

function fail(message: string): never {
  throw new Error(`Wallet conformance failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function cleanupFrom(value: WalletConformanceCleanup): () => Promise<void> {
  if (typeof value === "function") {
    return async () => {
      await value();
    };
  }

  if (value && typeof value === "object" && typeof value.cleanup === "function") {
    return async () => {
      await value.cleanup?.();
    };
  }

  return async () => {};
}

function assertExpectedProvider(
  state: DuskWalletState,
  expected: WalletConformanceOptions["expectedProvider"]
) {
  if (!expected) return;

  if (expected.uuid) {
    assert(
      state.providerId === expected.uuid,
      `expected provider id "${expected.uuid}" but found "${state.providerId ?? "none"}"`
    );
  }

  if (expected.name) {
    assert(
      state.providerInfo?.name === expected.name,
      `expected provider name "${expected.name}" but found "${state.providerInfo?.name ?? "none"}"`
    );
  }

  if (expected.rdns) {
    assert(
      state.providerInfo?.rdns === expected.rdns,
      `expected provider rdns "${expected.rdns}" but found "${state.providerInfo?.rdns ?? "none"}"`
    );
  }
}

function assertBalance(balance: BalanceResult) {
  assert(typeof balance.nonce === "string" && balance.nonce.length > 0, "balance.nonce must be a non-empty string");
  assert(typeof balance.value === "string" && balance.value.length > 0, "balance.value must be a non-empty string");
}

function assertCapabilities(capabilities: DuskProviderCapabilities) {
  assert(typeof capabilities.provider === "string" && capabilities.provider.length > 0, "capabilities.provider must be a non-empty string");
  assert(Array.isArray(capabilities.methods), "capabilities.methods must be an array");
  assert(capabilities.methods.includes("dusk_requestAccounts"), "capabilities.methods must include dusk_requestAccounts");
  assert(capabilities.methods.includes("dusk_accounts"), "capabilities.methods must include dusk_accounts");
  assert(capabilities.methods.includes("dusk_chainId"), "capabilities.methods must include dusk_chainId");
}

function assertExpectedNode(
  node: DuskNodeChangedPayload | null,
  expected: Partial<DuskNodeChangedPayload> | undefined
) {
  if (!expected) return;

  assert(node, "expected a duskNodeChanged payload after switching chains");

  if (expected.chainId) {
    assert(node.chainId === expected.chainId, `expected node.chainId "${expected.chainId}" but found "${node.chainId}"`);
  }

  if (expected.nodeUrl) {
    assert(node.nodeUrl === expected.nodeUrl, `expected node.nodeUrl "${expected.nodeUrl}" but found "${node.nodeUrl}"`);
  }

  if (expected.networkName) {
    assert(
      node.networkName === expected.networkName,
      `expected node.networkName "${expected.networkName}" but found "${node.networkName}"`
    );
  }
}

/**
 * Run a basic conformance pass against an injected Dusk wallet implementation.
 *
 * This helper is designed for wallet repositories that want a minimal
 * certification-style test without importing Vitest-specific helpers from this
 * package. Run it inside a browser-like test environment such as jsdom.
 */
export async function runWalletConformance(
  options: WalletConformanceOptions
): Promise<WalletConformanceReport> {
  if (typeof window === "undefined") {
    fail("runWalletConformance requires a browser-like environment with window");
  }

  const installCleanup = cleanupFrom(await options.installWallet(window));
  const wallet = createDuskWallet({
    preferredProviderId: options.preferredProviderId ?? options.expectedProvider?.uuid ?? null,
  });

  const accountEvents: AccountId[][] = [];
  const chainEvents: ChainId[] = [];
  const nodeEvents: DuskNodeChangedPayload[] = [];
  let stopAccounts = () => {};
  let stopChain = () => {};
  let stopNode = () => {};

  try {
    await wallet.ready();

    const initialState = wallet.state;
    assert(initialState.installed, "no wallet provider was discovered");
    assert(initialState.availableProviders.length > 0, "availableProviders is empty after discovery");
    assertExpectedProvider(initialState, options.expectedProvider);

    if (options.expectedChainId) {
      assert(
        initialState.chainId === options.expectedChainId,
        `expected chain "${options.expectedChainId}" but found "${initialState.chainId ?? "none"}"`
      );
    }

    stopAccounts = wallet.on("accountsChanged", (accounts) => {
      accountEvents.push([...accounts]);
    });
    stopChain = wallet.on("chainChanged", (chainId) => {
      chainEvents.push(chainId);
    });
    stopNode = wallet.on("duskNodeChanged", (payload) => {
      nodeEvents.push({ ...payload });
    });

    const connectedAccounts = await wallet.connect();
    assert(connectedAccounts.length > 0, "dusk_requestAccounts returned no accounts");

    if (options.expectedAccount) {
      assert(
        connectedAccounts[0] === options.expectedAccount,
        `expected first account "${options.expectedAccount}" but found "${connectedAccounts[0] ?? "none"}"`
      );
    }

    const capabilities = await wallet.getCapabilities();
    assertCapabilities(capabilities);

    const balance = options.requestBalance === false ? null : await wallet.getPublicBalance();
    if (balance) assertBalance(balance);

    let afterSwitch: WalletConformanceReport["afterSwitch"] = null;

    if (options.switchChain) {
      await wallet.switchChain(options.switchChain.params);

      const nextState = wallet.state;
      afterSwitch = {
        chainId: nextState.chainId,
        node: nextState.node ? { ...nextState.node } : null,
      };

      if (options.switchChain.expectedChainId) {
        assert(
          nextState.chainId === options.switchChain.expectedChainId,
          `expected switched chain "${options.switchChain.expectedChainId}" but found "${nextState.chainId ?? "none"}"`
        );
      }

      assertExpectedNode(nextState.node, options.switchChain.expectedNode);
    }

    return {
      initialState,
      connectedAccounts: [...connectedAccounts],
      capabilities,
      balance,
      events: {
        accountsChanged: accountEvents.map((accounts) => [...accounts]),
        chainChanged: [...chainEvents],
        nodeChanged: nodeEvents.map((payload) => ({ ...payload })),
      },
      afterSwitch,
    };
  } finally {
    stopAccounts();
    stopChain();
    stopNode();
    wallet.destroy();
    await installCleanup();
  }
}
