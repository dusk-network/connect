import { describe, expect, it, vi } from "vitest";

import { createDuskContract } from "./contract.js";

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
    chainId: "dusk:1",
    selectedAddress: null as string | null,
  };

  return {
    state,
    connect: vi.fn(async () => {
      state.authorized = true;
      state.accounts = ["dusk1writer"];
      state.selectedAddress = "dusk1writer";
      return [...state.accounts];
    }),
    sendContractCall: vi.fn(async () => ({ hash: "0xtxhash", nonce: "9" })),
    refresh: vi.fn(async () => state),
    getChainId: vi.fn(async () => state.chainId),
    switchChain: vi.fn(async () => null),
  } as any;
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
      defaultTx: { amount: "1", gas: { limit: "2", price: "3" }, display: { preset: true } },
    });

    const tx = await contract.tx["transfer"]!(
      { to: "dusk1dest", value: 42n },
      { deposit: "5", display: { fromUser: true } }
    );

    expect(tx).toMatchObject({
      contractId: "0x" + "aa".repeat(32),
      fnName: "transfer",
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

  it("writes through the wallet with auto-connect, ensureChain, and tx status updates", async () => {
    const driver = createDriver();
    const wallet = createWalletStub();
    const node = {
      waitForTxExecuted: vi.fn(async () => ({
        headers: new Headers(),
        payload: { success: true },
      })),
    };

    const contract = createDuskContract({
      contractId: "0x" + "22".repeat(32),
      driver,
      wallet,
      node: node as any,
      chain: { chainId: "dusk:2" },
    });

    const handle = await contract.write["transfer"]!({ to: "dusk1dest", value: "7" });
    const statuses: string[] = [];

    handle.onStatus((update) => {
      statuses.push(update.status);
    });

    const receiptA = handle.wait();
    const receiptB = handle.wait();

    await expect(receiptA).resolves.toMatchObject({ status: "executed", ok: true });
    await expect(receiptB).resolves.toMatchObject({ status: "executed", ok: true });

    expect(wallet.connect).toHaveBeenCalledTimes(1);
    expect(wallet.switchChain).toHaveBeenCalledWith({ chainId: "dusk:2" });
    expect(wallet.sendContractCall).toHaveBeenCalledTimes(1);
    expect(node.waitForTxExecuted).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["submitted", "executing", "executed"]);
  });

  it("turns tx wait transport failures into timeout receipts with context", async () => {
    const contract = createDuskContract({
      contractId: "0x" + "33".repeat(32),
      driver: createDriver(),
      wallet: {
        state: { authorized: true, accounts: ["dusk1writer"], chainId: "dusk:2" },
        connect: vi.fn(),
        sendContractCall: vi.fn(async () => ({ hash: "0xlate", nonce: "1" })),
      } as any,
      node: {
        waitForTxExecuted: vi.fn(async () => {
          throw new Error("socket down");
        }),
      } as any,
    });

    const handle = await contract.write["ping"]!();
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
