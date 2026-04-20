// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installReferenceWallet } from "./test/referenceWallet.js";
import { runWalletConformance } from "./testing.js";
import { createDuskWallet } from "./wallet.js";

describe("integration: wallet implementer reference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("shows how a third-party wallet can integrate through discovery, connection, and provider events", async () => {
    let fixture;

    const report = await runWalletConformance({
      installWallet: () => {
        fixture = installReferenceWallet({
          info: {
            uuid: "com.example.wallet",
            name: "Example Wallet",
            rdns: "com.example.wallet",
          },
          accounts: ["dusk1examplewalletaccount1111111111111111111111111111"],
          chainId: "dusk:2",
        });
        return fixture;
      },
      expectedProvider: {
        uuid: "com.example.wallet",
        name: "Example Wallet",
        rdns: "com.example.wallet",
      },
      expectedAccount: "dusk1examplewalletaccount1111111111111111111111111111",
      expectedChainId: "dusk:2",
      switchChain: {
        params: { chainId: "dusk:3" },
        expectedChainId: "dusk:3",
        expectedNode: {
          chainId: "dusk:3",
          nodeUrl: "https://devnet.nodes.dusk.network",
          networkName: "Devnet",
        },
      },
    });

    expect(report.connectedAccounts).toEqual([
      "dusk1examplewalletaccount1111111111111111111111111111",
    ]);
    expect(report.events.accountsChanged).toContainEqual([
      "dusk1examplewalletaccount1111111111111111111111111111",
    ]);
    expect(report.events.chainChanged).toContain("dusk:3");
    expect(report.events.nodeChanged).toContainEqual({
      chainId: "dusk:3",
      nodeUrl: "https://devnet.nodes.dusk.network",
      networkName: "Devnet",
    });

    fixture = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Example Wallet",
        rdns: "com.example.wallet",
      },
      accounts: ["dusk1examplewalletaccount1111111111111111111111111111"],
      chainId: "dusk:2",
      announceOnStart: false,
    });

    const onAccountsChanged = vi.fn();
    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });
    wallet.on("accountsChanged", onAccountsChanged);
    fixture.announce();
    await wallet.ready();
    await wallet.connect();

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

    wallet.destroy();
    fixture.cleanup();
  });

  it("treats account revocation and disconnect events as disconnected state", async () => {
    const fixture = installReferenceWallet({
      info: {
        uuid: "com.example.wallet",
        name: "Example Wallet",
        rdns: "com.example.wallet",
      },
      accounts: ["dusk1examplewalletaccount1111111111111111111111111111"],
      chainId: "dusk:2",
    });

    const onAccountsChanged = vi.fn();
    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });
    wallet.on("accountsChanged", onAccountsChanged);
    await wallet.ready();
    await wallet.connect();

    fixture.provider.revokePermissions();

    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.state.selectedAddress).toBeNull();
    expect(onAccountsChanged).toHaveBeenLastCalledWith([]);

    await wallet.connect();
    fixture.provider.emit("disconnect", { code: 4900, message: "Disconnected" });

    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.state.selectedAddress).toBeNull();

    wallet.destroy();
    fixture.cleanup();
  });
});
