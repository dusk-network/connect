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

  it("does not replace a selected provider with a UUID collision", async () => {
    const selected = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Selected Wallet",
        rdns: "com.example.wallet",
      },
      accounts: ["dusk1selected111111111111111111111111111111111111111"],
      announceOnStart: false,
    });
    const wallet = createDuskWallet();
    await wallet.ready();
    expect(wallet.provider).toBe(selected.provider);

    const collision = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Colliding Wallet",
        rdns: "com.example.collision",
      },
      accounts: ["dusk1collision1111111111111111111111111111111111111"],
      announceOnStart: false,
    });
    collision.announce();
    await Promise.resolve();

    expect(wallet.provider).toBe(selected.provider);
    expect(wallet.providerInfo?.name).toBe("Selected Wallet");

    selected.info.name = "Updated Selected Wallet";
    selected.announce();
    await Promise.resolve();
    expect(wallet.providerInfo?.name).toBe("Updated Selected Wallet");

    wallet.destroy();
    selected.cleanup();
    collision.cleanup();
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
      {
        profileId: "profile:0",
        account: "dusk1betawalletaccount111111111111111111111111111111",
      },
    ]);

    primary.provider.emit("profilesChanged", [
      {
        profileId: "profile:0",
        account: "dusk1alphachangedwallet111111111111111111111111111111",
      },
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
