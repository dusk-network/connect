// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installReferenceWallet } from "./test/referenceWallet.js";
import { runWalletConformance } from "./testing.js";

describe("testing helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("runs a reusable conformance pass against a wallet implementation", async () => {
    const report = await runWalletConformance({
      installWallet: () =>
        installReferenceWallet({
          info: {
            uuid: "com.example.wallet",
            name: "Example Wallet",
            rdns: "com.example.wallet",
          },
          accounts: ["dusk1examplewalletaccount1111111111111111111111111111"],
          chainId: "dusk:2",
        }),
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
    expect(report.balance).toEqual({
      nonce: "7",
      value: "12500000000",
    });
    expect(report.events.accountsChanged).toContainEqual([
      "dusk1examplewalletaccount1111111111111111111111111111",
    ]);
    expect(report.afterSwitch).toEqual({
      chainId: "dusk:3",
      node: {
        chainId: "dusk:3",
        nodeUrl: "https://devnet.nodes.dusk.network",
        networkName: "Devnet",
      },
    });
  });

  it("fails with a clear provider mismatch error", async () => {
    await expect(
      runWalletConformance({
        installWallet: () =>
          installReferenceWallet({
            info: {
              uuid: "dev.reference.wallet",
            },
          }),
        expectedProvider: {
          uuid: "com.example.wallet",
        },
      })
    ).rejects.toThrow(
      'Wallet conformance failed: expected provider id "com.example.wallet" but found "dev.reference.wallet"'
    );
  });
});
