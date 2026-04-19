import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWasmDataDriverMock, createDuskNodeClientMock } = vi.hoisted(() => ({
  fetchWasmDataDriverMock: vi.fn(),
  createDuskNodeClientMock: vi.fn(),
}));

vi.mock("./driver.js", () => ({
  fetchWasmDataDriver: fetchWasmDataDriverMock,
}));

vi.mock("./node.js", () => ({
  createDuskNodeClient: createDuskNodeClientMock,
}));

import { createDuskApp } from "./app.js";
import { createDuskWallet } from "./wallet.js";
import { createMockProvider, makeNodeChangedPayload } from "./test/mocks.js";

const VALID_CONTRACT_ID = "0x" + "11".repeat(32);

function createDriverStub() {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  return {
    encodeInputFn: vi.fn((fnName: string, json: string) => enc.encode(`${fnName}:${json}`)),
    decodeInputFn: vi.fn(),
    decodeOutputFn: vi.fn((_fnName: string, bytes: Uint8Array) => ({
      text: dec.decode(bytes),
    })),
    decodeEvent: vi.fn(),
    getSchema: vi.fn(() => ({ ok: true })),
    getVersion: vi.fn(() => "1.0.0"),
  };
}

describe("app facade", () => {
  beforeEach(() => {
    fetchWasmDataDriverMock.mockReset();
    createDuskNodeClientMock.mockReset();
  });

  it("validates contract presets eagerly", () => {
    expect(() =>
      createDuskApp({
        contracts: {
          broken: {
            contractId: "0x1234",
            driverUrl: "/driver.wasm",
          },
        },
      })
    ).toThrow(/contracts\.broken\.contractId/i);
  });

  it("caches drivers and evicts failed fetches", async () => {
    const nodeClient = {
      getBaseUrl: vi.fn(() => "https://nodes.dusk.network"),
      contractCall: vi.fn(),
      waitForTxExecuted: vi.fn(),
    };
    createDuskNodeClientMock.mockReturnValue(nodeClient);

    fetchWasmDataDriverMock.mockResolvedValue(createDriverStub());

    const app = createDuskApp();
    const [a, b] = await Promise.all([app.driver("/driver.wasm"), app.driver("/driver.wasm")]);
    expect(a).toBe(b);
    expect(fetchWasmDataDriverMock).toHaveBeenCalledTimes(1);

    fetchWasmDataDriverMock.mockRejectedValue(new Error("boom"));
    await expect(app.driver("/broken.wasm")).rejects.toThrow(/boom/);
    await expect(app.driver("/broken.wasm")).rejects.toThrow(/boom/);
    expect(fetchWasmDataDriverMock).toHaveBeenCalledTimes(3);
  });

  it("caches preset contract facades and delegates read/write flows", async () => {
    const provider = createMockProvider({
      accounts: ["dusk1appacct"],
      authorized: false,
      chainId: "dusk:2",
    });
    const wallet = createDuskWallet({
      provider,
      waitForProvider: false,
      autoRefresh: false,
    });
    const nodeClient = {
      getBaseUrl: vi.fn(() => "https://nodes.dusk.network"),
      contractCall: vi.fn(async () => new TextEncoder().encode("node-result")),
      waitForTxExecuted: vi.fn(async () => ({
        headers: new Headers(),
        payload: { success: true },
      })),
    };
    createDuskNodeClientMock.mockReturnValue(nodeClient);
    fetchWasmDataDriverMock.mockResolvedValue(createDriverStub());

    const app = createDuskApp({
      wallet,
      chain: { chainId: "dusk:2" },
      contracts: {
        demo: {
          contractId: VALID_CONTRACT_ID,
          driverUrl: "/demo.wasm",
          name: "Demo",
        },
      },
    });

    const contractA = app.contract("demo");
    const contractB = app.contract("demo");
    expect(contractA).toBe(contractB);

    await expect(
      app.readContract({
        contract: "demo",
        functionName: "ping",
        args: { ok: true },
      })
    ).resolves.toEqual({ text: "node-result" });

    const prepared = await app.prepareContractCall({
      contract: "demo",
      functionName: "ping",
      args: { ok: true },
      amount: "5",
    });

    expect(prepared).toMatchObject({
      contractId: VALID_CONTRACT_ID,
      fnName: "ping",
      amount: "5",
      display: {
        contractName: "Demo",
        methodSig: "ping",
      },
    });

    const handle = await app.writeContract({
      contract: "demo",
      functionName: "ping",
      args: { ok: true },
    });

    await expect(handle.wait()).resolves.toMatchObject({ status: "executed", ok: true });
    expect(provider.request).toHaveBeenCalledWith({
      method: "dusk_requestAccounts",
      params: undefined,
    });
    expect(provider.request).toHaveBeenCalledWith({
      method: "dusk_sendTransaction",
      params: expect.objectContaining({
        kind: "contract_call",
        contractId: VALID_CONTRACT_ID,
        fnName: "ping",
      }),
    });
  });

  it("prefers the wallet-emitted node url over the fallback", async () => {
    const provider = createMockProvider({
      authorized: true,
      accounts: ["dusk1wallet"],
    });
    const wallet = createDuskWallet({
      provider,
      waitForProvider: false,
      autoRefresh: false,
    });
    createDuskNodeClientMock.mockReturnValue({
      getBaseUrl: vi.fn(() => "https://fallback.nodes.dusk.network"),
      contractCall: vi.fn(),
      waitForTxExecuted: vi.fn(),
    });
    fetchWasmDataDriverMock.mockResolvedValue(createDriverStub());

    const app = createDuskApp({
      wallet,
      nodeUrl: "https://fallback.nodes.dusk.network/",
    });

    expect(app.nodeUrl()).toBe("https://fallback.nodes.dusk.network");

    provider.emit(
      "duskNodeChanged",
      makeNodeChangedPayload({ nodeUrl: "https://wallet.nodes.dusk.network/" })
    );

    expect(app.nodeUrl()).toBe("https://wallet.nodes.dusk.network");
  });

  it("turns tx wait transport errors into timeout receipts with context", async () => {
    createDuskNodeClientMock.mockReturnValue({
      getBaseUrl: vi.fn(() => "https://nodes.dusk.network"),
      contractCall: vi.fn(),
      waitForTxExecuted: vi.fn(async () => {
        throw new Error("rues unavailable");
      }),
    });
    fetchWasmDataDriverMock.mockResolvedValue(createDriverStub());

    const app = createDuskApp();
    await expect(app.waitForTxReceipt("0xdeadbeef")).resolves.toMatchObject({
      status: "timeout",
      ok: false,
      error: expect.stringContaining("Unable to track tx execution: rues unavailable"),
    });
  });
});
