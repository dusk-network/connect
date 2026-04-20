// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DuskWalletProviderSelectionError } from "./errors.js";
import { installReferenceWallet } from "./test/referenceWallet.js";
import { createDuskWallet } from "./wallet.js";

describe("integration: multi-provider wallet selection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("keeps provider selection deterministic when multiple wallets coexist", async () => {
    const primary = installReferenceWallet({
      info: {
        uuid: "com.example.alpha",
        name: "Alpha Wallet",
        rdns: "com.example.alpha",
      },
      accounts: ["dusk1alphawalletaccount11111111111111111111111111111"],
      chainId: "dusk:2",
      announceOnStart: false,
    });
    const secondary = installReferenceWallet({
      info: {
        uuid: "com.example.beta",
        name: "Beta Wallet",
        rdns: "com.example.beta",
      },
      accounts: ["dusk1betawalletaccount111111111111111111111111111111"],
      chainId: "dusk:3",
      announceOnStart: false,
    });

    const ambiguousWallet = createDuskWallet();
    await ambiguousWallet.ready();

    expect(ambiguousWallet.state.availableProviders.map((item) => item.uuid)).toEqual([
      "com.example.alpha",
      "com.example.beta",
    ]);
    expect(ambiguousWallet.state.providerId).toBeNull();
    await expect(ambiguousWallet.connect()).rejects.toBeInstanceOf(
      DuskWalletProviderSelectionError
    );
    ambiguousWallet.destroy();

    const wallet = createDuskWallet({
      preferredProviderId: "com.example.beta",
    });
    await wallet.ready();

    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual([
      "com.example.alpha",
      "com.example.beta",
    ]);
    expect(wallet.state.providerId).toBe("com.example.beta");
    expect(wallet.state.providerInfo?.name).toBe("Beta Wallet");

    await expect(wallet.connect()).resolves.toEqual([
      "dusk1betawalletaccount111111111111111111111111111111",
    ]);

    primary.provider.emit("accountsChanged", [
      "dusk1alphachangedwallet111111111111111111111111111111",
    ]);
    primary.provider.emit("chainChanged", "dusk:1");

    expect(wallet.state.providerId).toBe("com.example.beta");
    expect(wallet.state.accounts).toEqual([
      "dusk1betawalletaccount111111111111111111111111111111",
    ]);
    expect(wallet.state.chainId).toBe("dusk:3");

    secondary.provider.setAccounts([
      "dusk1betachangedwallet111111111111111111111111111111",
    ]);

    expect(wallet.state.accounts).toEqual([
      "dusk1betachangedwallet111111111111111111111111111111",
    ]);
    expect(wallet.state.selectedAddress).toBe(
      "dusk1betachangedwallet111111111111111111111111111111"
    );

    wallet.destroy();
    primary.cleanup();
    secondary.cleanup();
  });
});
