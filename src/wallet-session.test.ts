// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDuskWallet } from "./wallet.js";
import { createMockProvider } from "./test/mocks.js";
import type { DuskProfile } from "./types.js";

describe("same-provider session and network changes", () => {
  it.each(["connect", "getProfiles", "refresh"] as const)(
    "%s must not restore profiles after completed disconnect",
    async (method) => {
      const provider = createMockProvider({ authorized: true });
      const wallet = createDuskWallet({ provider, autoRefresh: false });
      await wallet.ready();
      const snapshot = wallet.state.profiles;
      let release!: (profiles: DuskProfile[]) => void;
      const delayed = new Promise<DuskProfile[]>((resolve) => { release = resolve; });
      provider.setResponse(method === "connect" ? "dusk_requestProfiles" : "dusk_profiles", () => delayed);
      const pending = wallet[method]().catch(() => undefined);
      try {
        await wallet.disconnect();
        expect(wallet.state.accounts).toEqual([]);
        expect(provider.isAuthorized).toBe(false);
        release(snapshot);
        await pending;
        expect(wallet.state).toMatchObject({ authorized: false, accounts: [], profiles: [] });
      } finally {
        release(snapshot);
        await pending;
        wallet.destroy();
      }
    }
  );

  it("keeps profiles cleared when a provider locks without revoking permission", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const snapshot = wallet.state.profiles;
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    const pending = wallet.getProfiles().catch(() => undefined);
    try {
      provider.setProfiles([]);
      release(snapshot);
      await pending;
      expect(wallet.state).toMatchObject({ authorized: true, profiles: [], accounts: [] });
      provider.setAccounts(["new-account"]);
      expect(wallet.state.accounts).toEqual(["new-account"]);
    } finally { release(snapshot); await pending; wallet.destroy(); }
  });

  it("does not restore a shielded profile after disconnect, and keeps later events working", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const response = { address: "disposable-test-address", account: wallet.state.accounts[0], profileId: "profile:0" };
    let release!: (address: typeof response) => void;
    provider.setResponse("dusk_requestShieldedAddress", () => new Promise<typeof response>(resolve => { release = resolve; }));
    const pending = wallet.requestShieldedAddress().catch(() => undefined);
    try {
      await wallet.disconnect();
      release(response);
      await pending;
      expect(wallet.state).toMatchObject({ authorized: false, profiles: [] });
      await wallet.connect();
      provider.setAccounts(["new-account"]);
      provider.setChainId("dusk:3");
      expect(wallet.state).toMatchObject({ authorized: true, accounts: ["new-account"], chainId: "dusk:3" });
    } finally { release(response); await pending; wallet.destroy(); }
  });

  it("refresh must not undo a newer chain/node change from the same provider", async () => {
    const provider = createMockProvider({ authorized: true, chainId: "dusk:2" });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let release!: (chain: string) => void;
    provider.setResponse("dusk_chainId", () => new Promise<string>((resolve) => { release = resolve; }));
    const pending = wallet.refresh().catch(() => undefined);
    try {
      provider.setChainId("dusk:3");
      provider.emit("duskNodeChanged", { chainId: "dusk:3", nodeUrl: "https://nodes.dusk.network", networkName: "Mainnet" });
      expect(wallet.state.chainId).toBe("dusk:3");
      release("dusk:2");
      await pending;
      expect(wallet.state).toMatchObject({
        chainId: "dusk:3",
        node: { nodeUrl: "https://nodes.dusk.network" },
      });
    } finally {
      release("dusk:2");
      await pending;
      wallet.destroy();
    }
  });
});
