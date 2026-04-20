// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DUSK_ANNOUNCE_PROVIDER_EVENT,
  DUSK_REQUEST_PROVIDER_EVENT,
} from "./discovery.js";
import {
  DuskWalletUnsupportedMethodError,
  DuskWalletUserRejectedError,
  ERROR_CODES,
} from "./errors.js";
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

  it("ignores malformed provider announcements and keeps the valid wallet selectable", async () => {
    const report = await runWalletConformance({
      installWallet: (target) => {
        const onRequest = () => {
          target.dispatchEvent(
            new CustomEvent(DUSK_ANNOUNCE_PROVIDER_EVENT, {
              detail: {
                info: {
                  uuid: " ",
                  name: "",
                  icon: "",
                  rdns: " ",
                },
                provider: {},
              },
            })
          );
        };

        target.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
        const fixture = installReferenceWallet({
          info: {
            uuid: "com.example.wallet",
            name: "Example Wallet",
            rdns: "com.example.wallet",
          },
        });

        return {
          cleanup() {
            target.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
            fixture.cleanup();
          },
        };
      },
      expectedProvider: {
        uuid: "com.example.wallet",
      },
    });

    expect(report.initialState.availableProviders.map((item) => item.uuid)).toEqual([
      "com.example.wallet",
    ]);
  });

  it("surfaces a user rejection during connect", async () => {
    await expect(
      runWalletConformance({
        installWallet: () =>
          installReferenceWallet({
            requestOverrides: {
              dusk_requestAccounts: async () => {
                throw Object.assign(new Error("User rejected connection"), {
                  code: ERROR_CODES.USER_REJECTED,
                });
              },
            },
          }),
      })
    ).rejects.toBeInstanceOf(DuskWalletUserRejectedError);
  });

  it("surfaces an unsupported switchNetwork request", async () => {
    await expect(
      runWalletConformance({
        installWallet: () =>
          installReferenceWallet({
            info: {
              uuid: "com.example.wallet",
              name: "Example Wallet",
              rdns: "com.example.wallet",
            },
            unsupportedMethods: ["dusk_switchNetwork"],
          }),
        expectedProvider: {
          uuid: "com.example.wallet",
        },
        requestBalance: false,
        switchChain: {
          params: { chainId: "dusk:3" },
        },
      })
    ).rejects.toBeInstanceOf(DuskWalletUnsupportedMethodError);
  });
});
