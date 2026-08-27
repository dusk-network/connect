import { describe, expect, it, vi } from "vitest";

import { createDuskContract } from "./contract.js";
import { DuskTxTrackingUnavailableError, DuskWalletProviderChangedError } from "./errors.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function createDriver() {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  return {
    encodeInputFn: vi.fn((fnName: string, json: string) => enc.encode(`${fnName}:${json}`)),
    decodeInputFn: vi.fn(),
    decodeOutputFn: vi.fn((_fnName: string, bytes: Uint8Array) => ({
      decoded: dec.decode(bytes),
    })),
    decodeEvent: vi.fn(),
    getSchema: vi.fn(() => ({ methods: ["ping"] })),
    getVersion: vi.fn(() => "1.2.3"),
  };
}

function createWalletStub() {
  const state = {
    authorized: false,
    accounts: [] as string[],
    profiles: [] as any[],
    chainId: "dusk:1",
    providerId: null as string | null,
    node: null as any,
    selectedAddress: null as string | null,
    selectedProfile: null as any,
  };

  return {
    state,
    networkEpoch: 0,
    connect: vi.fn(async () => {
      state.authorized = true;
      state.accounts = ["dusk1writer"];
      state.profiles = [{ profileId: "profile:0", account: "dusk1writer" }];
      state.selectedAddress = "dusk1writer";
      state.selectedProfile = state.profiles[0];
      return [...state.accounts];
    }),
    sendContractCall: vi.fn(async () => ({ hash: "0x" + "ab".repeat(32), nonce: "9" })),
    refresh: vi.fn(async () => state),
    getChainId: vi.fn(async () => state.chainId),
    switchChain: vi.fn(async () => null),
  } as any;
}

async function createWaitHandle(waitForTxExecuted: ReturnType<typeof vi.fn>) {
  const wallet = createWalletStub();
  wallet.state.authorized = true;
  wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node.example" };
  const contract = createDuskContract({
    contractId: "0x" + "33".repeat(32),
    driver: createDriver(),
    wallet,
    node: { getBaseUrl: () => "https://node.example", waitForTxExecuted } as any,
    defaultTx: { privacy: "public" },
  });
  return await contract.write["ping"]!();
}

describe("contract facade", () => {
  it("exposes schema/version and decodes read calls through the driver", async () => {
    const driver = createDriver();
    const node = {
      contractCall: vi.fn(async () => new TextEncoder().encode("result")),
    };

    const contract = createDuskContract({
      contractId: "0x" + "11".repeat(32),
      driver,
      node: node as any,
    });

    await expect(contract.schema()).resolves.toEqual({ methods: ["ping"] });
    await expect(contract.version()).resolves.toBe("1.2.3");
    await expect(contract.call["ping"]!({ count: 1 })).resolves.toEqual({
      decoded: "result",
    });

    expect(node.contractCall).toHaveBeenCalledWith(
      "11".repeat(32),
      "ping",
      expect.any(Uint8Array),
      undefined
    );
  });

  it("builds tx params with normalized ids and display metadata", async () => {
    const driver = createDriver();
    const contract = createDuskContract({
      contractId: new Uint8Array(32).fill(0xaa),
      driver,
      name: "Treasury",
      methodSigs: { transfer: "transfer(to: Account, value: u64)" },
      defaultTx: { privacy: "public", amount: "1", gas: { limit: "2", price: "3" }, display: { preset: true } },
    });

    const tx = await contract.tx["transfer"]!(
      { to: "dusk1dest", value: 42n },
      { privacy: "shielded", deposit: "5", display: { fromUser: true } }
    );

    expect(tx).toMatchObject({
      contractId: "0x" + "aa".repeat(32),
      fnName: "transfer",
      privacy: "shielded",
      amount: "1",
      deposit: "5",
      gas: { limit: "2", price: "3" },
      display: {
        contractName: "Treasury",
        methodSig: "transfer(to: Account, value: u64)",
        fromUser: true,
      },
    });
    expect(tx.fnArgs).toMatch(/^0x/);
  });

  it("does not expose contract facets as promises", async () => {
    const contract = createDuskContract({
      contractId: "0x" + "aa".repeat(32),
      driver: createDriver(),
    });

    expect((contract.call as any).then).toBeUndefined();
    expect((contract.tx as any).then).toBeUndefined();
    expect((contract.write as any).then).toBeUndefined();
    await expect(Promise.resolve(contract.call)).resolves.toBe(contract.call);
  });

  it("rejects tx params that do not declare privacy", async () => {
    const driver = createDriver();
    const contract = createDuskContract({
      contractId: "0x" + "aa".repeat(32),
      driver,
    });

    await expect(contract.tx["transfer"]!({ to: "dusk1dest", value: 42n })).rejects.toThrow(
      'privacy is required ("public" or "shielded")'
    );
  });

  it("writes through the wallet with auto-connect, ensureChain, and tx status updates", async () => {
    const driver = createDriver();
    const wallet = createWalletStub();
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node.example" };
    wallet.switchChain.mockImplementation(async ({ chainId }: { chainId: string }) => {
      wallet.networkEpoch++;
      wallet.state.chainId = chainId;
      wallet.state.node = { chainId, nodeUrl: "https://node.example" };
      return null;
    });
    const waitForTxExecuted = vi.fn(async () => ({
      headers: new Headers(),
      payload: { success: true },
    }));
    const node = {
      getBaseUrl: () => wallet.state.node.nodeUrl,
      pin: (baseUrl: string) => ({ getBaseUrl: () => baseUrl, waitForTxExecuted }),
      waitForTxExecuted,
    };

    const contract = createDuskContract({
      contractId: "0x" + "22".repeat(32),
      driver,
      wallet,
      node: node as any,
      chain: { chainId: "dusk:2" },
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["transfer"]!({ to: "dusk1dest", value: "7" });
    const statuses: string[] = [];

    handle.onStatus((update) => {
      statuses.push(update.status);
    });
    wallet.provider = { id: "secondary" };
    wallet.selectionEpoch++;
    wallet.state.node = { chainId: "dusk:3", nodeUrl: "https://node-b.example" };

    await expect(handle.wait()).resolves.toMatchObject({ status: "executed", ok: true });
    await expect(handle.wait()).resolves.toMatchObject({ status: "executed", ok: true });

    expect(wallet.connect).toHaveBeenCalledTimes(1);
    expect(wallet.switchChain).toHaveBeenCalledWith({ chainId: "dusk:2" });
    expect(wallet.sendContractCall).toHaveBeenCalledTimes(1);
    expect(waitForTxExecuted).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["submitted", "executing", "executed"]);
  });

  it("does not let a concurrent timeout overwrite a final receipt", async () => {
    const pending: Array<(event: any) => void> = [];
    const waitForTxExecuted = vi.fn(
      () => new Promise((resolve) => pending.push(resolve))
    );
    const handle = await createWaitHandle(waitForTxExecuted);
    const statuses: string[] = [];
    handle.onStatus((status) => statuses.push(status.status));
    const executed = handle.wait();
    const timeout = handle.wait();
    pending[0]!({ headers: new Headers(), payload: { success: true } });
    await expect(executed).resolves.toMatchObject({ status: "executed" });
    pending[1]!(null);
    await expect(timeout).resolves.toMatchObject({ status: "executed" });
    expect(statuses).toEqual(["submitted", "executing", "executed"]);
  });

  it("never tracks a late submission through the replacement provider", async () => {
    const wallet = createWalletStub();
    wallet.provider = { id: "primary" };
    wallet.selectionEpoch = 1;
    wallet.state.providerId = "wallet.primary";
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-a.example" };
    wallet.state.authorized = true;
    const submitted = deferred<any>();
    wallet.sendContractCall.mockImplementation(() => submitted.promise);
    const waitOnA = vi.fn(async () => ({ headers: new Headers(), payload: { success: true } }));
    const waitDynamic = vi.fn();
    const node = {
      getBaseUrl: () => wallet.state.node.nodeUrl,
      pin: vi.fn((baseUrl: string) => ({ getBaseUrl: () => baseUrl, waitForTxExecuted: waitOnA })),
      waitForTxExecuted: waitDynamic,
    };
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet,
      node: node as any,
      defaultTx: { privacy: "public" },
    });

    const writing = contract.write["ping"]!();
    await vi.waitFor(() => expect(wallet.sendContractCall).toHaveBeenCalled());
    wallet.provider = { id: "secondary" };
    wallet.selectionEpoch = 2;
    wallet.state.providerId = "wallet.secondary";
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-b.example" };
    submitted.resolve({ hash: "0xsubmitted", nonce: "8" });

    const handle = await writing;
    await expect(handle.wait()).rejects.toBeInstanceOf(DuskTxTrackingUnavailableError);
    expect(handle.origin).toMatchObject({ providerId: "wallet.primary", nodeUrl: "https://node-a.example" });
    expect(Object.isFrozen(handle.origin)).toBe(true);
    expect(node.pin).toHaveBeenCalledWith("https://node-a.example");
    expect(waitOnA).not.toHaveBeenCalled();
    expect(waitDynamic).not.toHaveBeenCalled();
  });

  it("does not pin stale state while a requested chain update is pending", async () => {
    const wallet = createWalletStub();
    wallet.state.authorized = true;
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-a.example" };
    const waitForTxExecuted = vi.fn();
    const node = {
      getBaseUrl: () => "https://node-a.example",
      pin: (baseUrl: string) => ({ getBaseUrl: () => baseUrl, waitForTxExecuted }),
      waitForTxExecuted,
    };
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(), wallet, node: node as any,
      chain: { chainId: "dusk:2" },
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["ping"]!();
    await expect(handle.wait()).rejects.toBeInstanceOf(DuskTxTrackingUnavailableError);
    expect(waitForTxExecuted).not.toHaveBeenCalled();
  });

  it("does not treat an app fallback as the wallet submission node", async () => {
    const wallet = createWalletStub();
    wallet.state.authorized = true;
    const waitForTxExecuted = vi.fn();
    const node = {
      getBaseUrl: () => "https://fallback.example",
      pin: (baseUrl: string) => ({ getBaseUrl: () => baseUrl, waitForTxExecuted }),
      waitForTxExecuted,
    };
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(), wallet, node: node as any,
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["ping"]!();
    await expect(handle.wait()).rejects.toBeInstanceOf(DuskTxTrackingUnavailableError);
    expect(waitForTxExecuted).not.toHaveBeenCalled();
  });

  it("refuses to guess when the endpoint changes during submission", async () => {
    const wallet = createWalletStub();
    wallet.provider = { id: "primary" };
    wallet.selectionEpoch = 1;
    wallet.state.authorized = true;
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-a.example" };
    wallet.sendContractCall.mockImplementation(async () => {
      wallet.networkEpoch++;
      wallet.state.chainId = "dusk:2";
      wallet.state.node = { chainId: "dusk:2", nodeUrl: "https://node-b.example" };
      wallet.networkEpoch++;
      wallet.state.chainId = "dusk:1";
      wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-a.example" };
      return { hash: "0xsubmitted", nonce: "8" };
    });
    const waitForTxExecuted = vi.fn();
    const node = {
      getBaseUrl: () => wallet.state.node.nodeUrl,
      pin: (baseUrl: string) => ({ getBaseUrl: () => baseUrl, waitForTxExecuted }),
      waitForTxExecuted,
    };
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(), wallet, node: node as any,
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["ping"]!();
    await expect(handle.wait()).rejects.toBeInstanceOf(DuskTxTrackingUnavailableError);
    expect(waitForTxExecuted).not.toHaveBeenCalled();
  });

  it("refuses to track through a changed custom node endpoint", async () => {
    const wallet = createWalletStub();
    wallet.state.authorized = true;
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-a.example" };
    const node = {
      getBaseUrl: () => wallet.state.node.nodeUrl,
      waitForTxExecuted: vi.fn(),
    };
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet,
      node: node as any,
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["ping"]!();
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node-b.example" };

    await expect(handle.wait()).rejects.toBeInstanceOf(DuskTxTrackingUnavailableError);
    expect(node.waitForTxExecuted).not.toHaveBeenCalled();
  });

  it("captures an existing provider without yielding to readiness", async () => {
    const wallet = createWalletStub();
    wallet.provider = { id: "primary" };
    wallet.selectionEpoch = 1;
    wallet.state.authorized = true;
    wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node.example" };
    wallet.ready = vi.fn(async () => {
      throw new Error("should not wait");
    });
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet,
      defaultTx: { privacy: "public" },
    });

    await expect(contract.write["ping"]!()).resolves.toBeDefined();
    expect(wallet.ready).not.toHaveBeenCalled();
  });

  it("waits for node hydration before capturing transaction origin", async () => {
    const wallet = createWalletStub();
    wallet.provider = { id: "primary" };
    wallet.selectionEpoch = 1;
    wallet.state.authorized = true;
    wallet.ready = vi.fn(async () => {
      wallet.state.node = { chainId: "dusk:1", nodeUrl: "https://node.example" };
    });
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet,
      node: { getBaseUrl: () => "https://node.example", waitForTxExecuted: vi.fn() } as any,
      defaultTx: { privacy: "public" },
    });

    const handle = await contract.write["ping"]!();
    expect(handle.origin.nodeUrl).toBe("https://node.example");
  });

  it("detects a provider changing away and back during encoding", async () => {
    const wallet = createWalletStub();
    const primary = { id: "primary" };
    wallet.provider = primary;
    wallet.selectionEpoch = 1;
    const driver = createDriver();
    let finishEncoding!: () => void;
    driver.encodeInputFn.mockImplementation(
      () => new Promise<Uint8Array>((resolve) => {
        finishEncoding = () => resolve(new Uint8Array([1]));
      }) as any
    );
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver,
      wallet,
      defaultTx: { privacy: "public" },
    });

    const write = contract.write["ping"]!();
    await vi.waitFor(() => expect(driver.encodeInputFn).toHaveBeenCalled());
    wallet.provider = { id: "secondary" };
    wallet.selectionEpoch = 2;
    wallet.provider = primary;
    wallet.selectionEpoch = 3;
    finishEncoding();

    await expect(write).rejects.toBeInstanceOf(DuskWalletProviderChangedError);
    expect(wallet.sendContractCall).not.toHaveBeenCalled();
  });

  it("does not submit when the provider changes during chain enforcement", async () => {
    const wallet = createWalletStub();
    wallet.provider = { id: "primary" };
    wallet.switchChain.mockImplementation(async () => {
      wallet.provider = { id: "secondary" };
      return null;
    });
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet,
      chain: { chainId: "dusk:2" },
      defaultTx: { privacy: "public" },
    });

    await expect(contract.write["ping"]!()).rejects.toBeInstanceOf(
      DuskWalletProviderChangedError
    );
    expect(wallet.sendContractCall).not.toHaveBeenCalled();
  });

  it("turns tx wait transport failures into timeout receipts with context", async () => {
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet: {
        state: {
          authorized: true,
          accounts: ["dusk1writer"],
          chainId: "dusk:2",
          node: { chainId: "dusk:2", nodeUrl: "https://node.example" },
        },
        connect: vi.fn(),
        sendContractCall: vi.fn(async () => ({ hash: "0x" + "ab".repeat(32), nonce: "1" })),
      } as any,
      node: {
        getBaseUrl: () => "https://node.example",
        waitForTxExecuted: vi.fn(async () => {
          throw new Error("socket down");
        }),
      } as any,
    });

    const handle = await contract.write["ping"]!(undefined, { privacy: "public" });
    await expect(handle.wait()).resolves.toMatchObject({
      status: "timeout",
      ok: false,
      error: expect.stringContaining("Unable to track tx execution: socket down"),
    });
  });

  it("keeps executing status while another concurrent wait is active", async () => {
    const pending: Array<{ resolve: (event: any) => void; reject: (error: Error) => void }> = [];
    const waitForTxExecuted = vi.fn(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
    );
    const handle = await createWaitHandle(waitForTxExecuted);
    const statuses: string[] = [];
    handle.onStatus((status) => statuses.push(status.status));
    const aborted = handle.wait();
    const executed = handle.wait();
    pending[0]!.reject(new Error("aborted"));
    await expect(aborted).resolves.toMatchObject({ status: "timeout" });
    expect(statuses).toEqual(["submitted", "executing"]);
    pending[1]!.resolve({ headers: new Headers(), payload: { success: true } });
    await expect(executed).resolves.toMatchObject({ status: "executed" });
  });

  it("publishes a pending timeout when the remaining wait aborts", async () => {
    const pending: Array<{ resolve: (event: any) => void; reject: (error: Error) => void }> = [];
    const waitForTxExecuted = vi.fn(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
    );
    const handle = await createWaitHandle(waitForTxExecuted);
    const statuses: string[] = [];
    handle.onStatus((status) => statuses.push(status.status));
    const timedOut = handle.wait();
    const controller = new AbortController();
    const aborted = handle.wait({ signal: controller.signal });
    pending[0]!.resolve(null);
    await expect(timedOut).resolves.toMatchObject({ status: "timeout" });
    expect(statuses).toEqual(["submitted", "executing"]);
    controller.abort();
    pending[1]!.reject(new Error("aborted"));
    await expect(aborted).rejects.toThrow("aborted");
    expect(statuses).toEqual(["submitted", "executing", "timeout"]);
  });

  it("does not reuse a superseded concurrent timeout", async () => {
    const waitForTxExecuted = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("aborted"));
    const handle = await createWaitHandle(waitForTxExecuted);
    const statuses: string[] = [];
    handle.onStatus((status) => statuses.push(status.status));

    await Promise.all([handle.wait(), handle.wait()]);
    const controller = new AbortController();
    controller.abort();
    await expect(handle.wait({ signal: controller.signal })).rejects.toThrow("aborted");
    expect(statuses).toEqual(["submitted", "executing", "timeout", "executing", "submitted"]);
  });

  it("serializes status notifications when a listener retries", async () => {
    const waitForTxExecuted = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ headers: new Headers(), payload: { success: true } });
    const handle = await createWaitHandle(waitForTxExecuted);
    const first: string[] = [];
    const second: string[] = [];
    const late: string[] = [];
    let retry!: Promise<any>;
    handle.onStatus((status) => {
      first.push(status.status);
      if (status.status === "timeout") {
        retry = handle.wait();
        handle.onStatus((update) => late.push(update.status));
      }
    });
    handle.onStatus((status) => second.push(status.status));

    await expect(handle.wait()).resolves.toMatchObject({ status: "timeout" });
    await expect(retry).resolves.toMatchObject({ status: "executed" });
    expect(first).toEqual(["submitted", "executing", "timeout", "executing", "executed"]);
    expect(second).toEqual(first);
    expect(late).toEqual(["executing", "executed"]);
  });

  it("allows retrying a timed-out wait", async () => {
    const waitForTxExecuted = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ headers: new Headers(), payload: { success: true } });
    const handle = await createWaitHandle(waitForTxExecuted);
    await expect(handle.wait({ timeoutMs: 1 })).resolves.toMatchObject({ status: "timeout" });
    await expect(handle.wait({ timeoutMs: 500 })).resolves.toMatchObject({ status: "executed" });
    expect(waitForTxExecuted).toHaveBeenCalledTimes(2);
  });

  it("allows retrying after an aborted wait", async () => {
    const waitForTxExecuted = vi
      .fn()
      .mockRejectedValueOnce(new Error("aborted"))
      .mockResolvedValueOnce({ headers: new Headers(), payload: { success: true } });
    const handle = await createWaitHandle(waitForTxExecuted);
    const controller = new AbortController();
    controller.abort();
    await expect(handle.wait({ signal: controller.signal })).rejects.toThrow("aborted");
    await expect(handle.wait()).resolves.toMatchObject({ status: "executed" });
    expect(waitForTxExecuted).toHaveBeenCalledTimes(2);
  });

  it("turns tx wait transport failures into timeout receipts with context", async () => {
    const handle = await createWaitHandle(
      vi.fn(async () => {
        throw new Error("socket down");
      })
    );
    await expect(handle.wait()).resolves.toMatchObject({
      status: "timeout",
      ok: false,
      error: expect.stringContaining("Unable to track tx execution: socket down"),
    });
  });

  it("requires the expected collaborators for call/write/wait helpers", async () => {
    const contract = createDuskContract({
      contractId: "0x" + "44".repeat(32),
      driver: createDriver(),
    });

    await expect(contract.call["ping"]!()).rejects.toThrow(/requires a node client/i);
    await expect(contract.write["ping"]!()).rejects.toThrow(/requires a wallet/i);
  });
});
