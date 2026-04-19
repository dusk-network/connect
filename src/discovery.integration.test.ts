// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { announceDuskProvider, DUSK_REQUEST_PROVIDER_EVENT } from "./discovery.js";
import { createDuskWallet } from "./wallet.js";
import { createMockProvider, createMockProviderInfo } from "./test/mocks.js";

describe("integration: wallet discovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("lets a wallet implementation register itself through the discovery events", async () => {
    const provider = createMockProvider({
      accounts: ["dusk1integration"],
      authorized: false,
      chainId: "dusk:2",
    });
    const info = createMockProviderInfo({
      uuid: "wallet.integration",
      name: "Integration Wallet",
      rdns: "dev.integration.wallet",
    });

    const onRequest = () => {
      announceDuskProvider({ info, provider });
    };

    window.addEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);

    const wallet = createDuskWallet();
    await wallet.ready();

    expect(wallet.state.availableProviders.map((item) => item.uuid)).toEqual(["wallet.integration"]);
    expect(wallet.state.providerId).toBe("wallet.integration");
    expect(wallet.state.providerInfo?.name).toBe("Integration Wallet");

    await expect(wallet.connect()).resolves.toEqual(["dusk1integration"]);
    expect(provider.request).toHaveBeenCalledWith({
      method: "dusk_requestAccounts",
      params: undefined,
    });

    window.removeEventListener(DUSK_REQUEST_PROVIDER_EVENT, onRequest);
  });
});
