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
      const pending = wallet[method]().catch(error => error);
      try {
        await wallet.disconnect();
        expect(wallet.state.accounts).toEqual([]);
        expect(provider.isAuthorized).toBe(false);
        release(snapshot);
        expect(await pending).toMatchObject({ name: "DuskSdkError", data: { reason: "session_changed" } });
        expect(wallet.state).toMatchObject({ authorized: false, accounts: [], profiles: [] });
      } finally {
        release(snapshot);
        await pending;
        wallet.destroy();
      }
    }
  );

  it.each(["getProfiles", "connect"] as const)("an old disconnect response does not invalidate a newer %s", async (method) => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let releaseDisconnect!: (value: boolean) => void;
    provider.setResponse("dusk_disconnect", () => {
      provider.setAuthorized(false);
      return new Promise<boolean>(resolve => { releaseDisconnect = resolve; });
    });
    const disconnect = wallet.disconnect();
    let releaseProfiles: (value: DuskProfile[]) => void = () => {};
    try {
      if (method === "getProfiles") {
        provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { releaseProfiles = resolve; }));
      }
      const fresh = wallet[method]();
      // Attach the expectation before delivering either late response.
      const expectation = expect(fresh).resolves.toBeInstanceOf(Array);
      if (method === "connect") await fresh;
      releaseDisconnect(true);
      await disconnect;
      releaseProfiles([]);
      await expectation;
      expect(wallet.state.authorized).toBe(method === "connect");
    } finally { releaseDisconnect(true); releaseProfiles([]); await disconnect; wallet.destroy(); }
  });

  it("discards older reads on a failed disconnect intent without claiming permission was revoked", async () => {
    const provider = createMockProvider({ authorized: true });
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    const snapshot = wallet.state.profiles;
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_profiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    provider.setResponse("dusk_disconnect", () => { throw new Error("Offline"); });
    const pending = wallet.getProfiles();
    const rejected = expect(pending).rejects.toThrow("session changed");
    try {
      await expect(wallet.disconnect()).rejects.toThrow("Offline");
      release(snapshot);
      await rejected;
      expect(wallet.state.authorized).toBe(true);
      provider.setResponse("dusk_profiles", undefined);
      await expect(wallet.getProfiles()).resolves.toEqual(snapshot);
    } finally { release(snapshot); await pending.catch(() => {}); wallet.destroy(); }
  });

  it("a disconnect event invalidates a pending first connection even if state was already empty", async () => {
    const provider = createMockProvider();
    const wallet = createDuskWallet({ provider, autoRefresh: false });
    await wallet.ready();
    let release!: (profiles: DuskProfile[]) => void;
    provider.setResponse("dusk_requestProfiles", () => new Promise<DuskProfile[]>(resolve => { release = resolve; }));
    const pending = wallet.connect();
    const expectation = expect(pending).rejects.toThrow("session changed");
    try {
      provider.emit("disconnect", { code: 4900, message: "Disconnected" });
      release([{ profileId: "profile:0", account: "old-account" }]);
      await expectation;
      expect(wallet.state).toMatchObject({ authorized: false, profiles: [] });
    } finally { release([]); await pending.catch(() => {}); wallet.destroy(); }
  });

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
    const pending = wallet.refresh().catch(error => error);
    try {
      provider.setChainId("dusk:3");
      provider.emit("duskNodeChanged", { chainId: "dusk:3", nodeUrl: "https://nodes.dusk.network", networkName: "Mainnet" });
      expect(wallet.state.chainId).toBe("dusk:3");
      release("dusk:2");
      expect(await pending).toMatchObject({ name: "DuskSdkError", data: { reason: "network_changed" } });
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
