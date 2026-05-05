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

    expect(report.connectedProfiles).toEqual([
      {
        profileId: "profile:0",
        account: "dusk1examplewalletaccount1111111111111111111111111111",
      },
    ]);
    expect(report.events.profilesChanged).toContainEqual([
      {
        profileId: "profile:0",
        account: "dusk1examplewalletaccount1111111111111111111111111111",
      },
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

    const onProfilesChanged = vi.fn();
    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });
    wallet.on("profilesChanged", onProfilesChanged);
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
    expect(onProfilesChanged).toHaveBeenCalledWith([
      {
        profileId: "profile:0",
        account: "dusk1updatedwalletaccount111111111111111111111111111",
      },
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

    const onProfilesChanged = vi.fn();
    const wallet = createDuskWallet({
      preferredProviderId: "com.example.wallet",
    });
    wallet.on("profilesChanged", onProfilesChanged);
    await wallet.ready();
    await wallet.connect();

    fixture.provider.revokePermissions();

    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.state.selectedAddress).toBeNull();
    expect(onProfilesChanged).toHaveBeenLastCalledWith([]);

    await wallet.connect();
    fixture.provider.emit("disconnect", { code: 4900, message: "Disconnected" });

    expect(wallet.state.authorized).toBe(false);
    expect(wallet.state.accounts).toEqual([]);
    expect(wallet.state.selectedAddress).toBeNull();

    wallet.destroy();
    fixture.cleanup();
  });
});
