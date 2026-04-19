// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDuskWallet } from "./wallet.js";
import { installReferenceWallet } from "./test/referenceWallet.js";

describe("integration: wallet implementer reference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("shows how a third-party wallet can integrate through discovery, connection, and provider events", async () => {
    const fixture = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Example Wallet",
        rdns: "com.example.wallet",
      },
      accounts: ["dusk1examplewalletaccount1111111111111111111111111111"],
      chainId: "dusk:2",
    });

    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });

    const onAccountsChanged = vi.fn();
    const onChainChanged = vi.fn();
    const onNodeChanged = vi.fn();
    wallet.on("accountsChanged", onAccountsChanged);
    wallet.on("chainChanged", onChainChanged);
    wallet.on("duskNodeChanged", onNodeChanged);

    await wallet.ready();

    expect(wallet.state.installed).toBe(true);
    expect(wallet.state.providerId).toBe("com.example.wallet");
    expect(wallet.state.providerInfo?.name).toBe("Example Wallet");
    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual(["com.example.wallet"]);

    await expect(wallet.connect()).resolves.toEqual([
      "dusk1examplewalletaccount1111111111111111111111111111",
    ]);

    expect(wallet.state.authorized).toBe(true);
    expect(wallet.state.accounts).toEqual([
      "dusk1examplewalletaccount1111111111111111111111111111",
    ]);
    expect(wallet.state.chainId).toBe("dusk:2");

    await expect(wallet.getPublicBalance()).resolves.toEqual({
      nonce: "7",
      value: "12500000000",
    });

    await expect(wallet.switchChain({ chainId: "dusk:3" })).resolves.toBeNull();

    expect(wallet.state.chainId).toBe("dusk:3");
    expect(wallet.state.node).toEqual({
      chainId: "dusk:3",
      nodeUrl: "https://devnet.nodes.dusk.network",
      networkName: "Devnet",
    });
    expect(onChainChanged).toHaveBeenCalledWith("dusk:3");
    expect(onNodeChanged).toHaveBeenCalledWith({
      chainId: "dusk:3",
      nodeUrl: "https://devnet.nodes.dusk.network",
      networkName: "Devnet",
    });

    fixture.provider.setAccounts(["dusk1updatedwalletaccount111111111111111111111111111"]);
    expect(wallet.state.accounts).toEqual([
      "dusk1updatedwalletaccount111111111111111111111111111",
    ]);
    expect(wallet.state.selectedAddress).toBe(
      "dusk1updatedwalletaccount111111111111111111111111111"
    );
    expect(onAccountsChanged).toHaveBeenCalledWith([
      "dusk1updatedwalletaccount111111111111111111111111111",
    ]);

    await expect(wallet.disconnect()).resolves.toBe(true);
    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);

    wallet.destroy();
    fixture.cleanup();
  });
});
