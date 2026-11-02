import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { hexToBytes } from "../bytes.js";
import { loadWasmDataDriver } from "../driver.js";
import { createMockProvider } from "../test/mocks.js";
import { createDuskWallet } from "../wallet.js";
import { createDrc20, DRC20_METHOD_SIGS, drcPrincipal } from "./drc20.js";

// The DRC20 standard's own data-driver: dusk-network/contracts 18d7ac7,
// standards/examples/drc20_roles_pausable, built with `cargo build --locked --release
// --target wasm32-unknown-unknown --features data-driver-js -p drc20-roles-pausable`.
const standard = (async () => {
  const driver = await loadWasmDataDriver(await readFile("examples/drc20-demo/data_driver.wasm"));
  driver.init?.();
  return driver;
})();

// Keys made the way the standard's tests make them (tests/primitives.rs, tests/drc20.rs).
const ALICE = "u5E9jR6rhTroj6gBnP3wMyvrQXTkE4hANU6unNhZeaA76pxgvJGugiYuwe6414TwadKKE41bgqJ32BNoVtvnA7oGeAVszCAwRhXvvs582sJ9wsvvFHqGRUfrzZ56uB8zyMX";
const BOB = "sqrtP6LvrNqtDWn4cic3hCXZatjoW3U3V2NoCPKt7QMkS2J3Lt7LZ7LZ9YZ7Go7N63RJcSP89GBxDS1Sgg9Fqq17LsvX9FAnCbZcV1LyqSTGRg4fdi8aoq75jdomJEgsC4y";
const PHOENIX = "J3W3PD1aVTtUwf4N7mthhuKb4KVutxQuZgy5SAt8RmkL";
const CONTRACT = "18".repeat(32);

const u64Bytes = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};

async function token(node?: unknown) {
  const provider = createMockProvider({ authorized: true });
  const wallet = createDuskWallet({ provider, autoRefresh: false });
  await wallet.ready();
  const drc20 = createDrc20({
    contractId: "0x" + "33".repeat(32), driver: await standard, wallet, node: node as any,
    defaultTx: { privacy: "public" },
  });
  const sent = () => provider.request.mock.calls
    .filter(([arg]) => arg.method === "dusk_sendTransaction")
    .map(([arg]) => arg.params);
  return { drc20, wallet, provider, sent };
}

describe("DRC20 helper against the standard's data-driver", () => {
  it("sends the standard's struct calls with exact amounts", async () => {
    const driver = await standard;
    const { drc20, wallet, sent } = await token();
    try {
      await drc20.write.transfer({ to: drcPrincipal(BOB), amount: 1_000_000_000_000_000_001n });
      await drc20.write.approve({ spender: drcPrincipal("0x" + CONTRACT.toUpperCase()), amount: "18446744073709551615" });
      await drc20.write.transferFrom({ owner: drcPrincipal(ALICE), to: { Phoenix: PHOENIX }, amount: "7" });
      expect(sent().map(params => hexToBytes(params.fnArgs))).toEqual([
        driver.encodeInputFn("transfer", `{"to":{"Moonlight":"${BOB}"},"amount":1000000000000000001}`),
        driver.encodeInputFn("approve", `{"spender":{"Contract":"${CONTRACT}"},"amount":18446744073709551615}`),
        driver.encodeInputFn("transfer_from",
          `{"owner":{"Moonlight":"${ALICE}"},"to":{"Phoenix":"${PHOENIX}"},"amount":7}`),
      ]);
      expect(sent()[1]).toMatchObject({
        fnName: "approve",
        display: {
          methodSig: DRC20_METHOD_SIGS["approve"], standard: "DRC20", op: "approve",
          spender: { Contract: CONTRACT }, valueUnits: "18446744073709551615", isMax: true,
        },
      });
    } finally { wallet.destroy(); }
  });

  it("reads balances and allowances through the standard's encoding", async () => {
    const driver = await standard;
    const contractCall = vi.fn(async (_id: string, fn: string) =>
      fn === "decimals" ? new Uint8Array([9]) : u64Bytes(1_000_000_000_000_000_001n));
    const { drc20, wallet } = await token({ contractCall });
    try {
      await expect(drc20.read.balanceOf({ account: drcPrincipal(ALICE) })).resolves.toBe("1000000000000000001");
      await expect(drc20.read.allowance({ owner: { Phoenix: PHOENIX }, spender: { Contract: "0x" + CONTRACT } }))
        .resolves.toBe("1000000000000000001");
      await expect(drc20.read.decimals()).resolves.toBe(9);
      expect(contractCall.mock.calls.map(([, fn, input]) => [fn, input])).toEqual([
        ["balance_of", driver.encodeInputFn("balance_of", `{"account":{"Moonlight":"${ALICE}"}}`)],
        ["allowance", driver.encodeInputFn("allowance",
          `{"owner":{"Phoenix":"${PHOENIX}"},"spender":{"Contract":"${CONTRACT}"}}`)],
        ["decimals", new Uint8Array()],
      ]);
    } finally { wallet.destroy(); }
  });

  it("refuses arguments outside the standard before asking the wallet", async () => {
    const { drc20, wallet, provider } = await token();
    const to = drcPrincipal(BOB);
    try {
      for (const amount of [-1n, 18446744073709551616n, "1.5", "-1", "0x10", "", 7 as unknown as bigint]) {
        await expect(drc20.write.transfer({ to, amount })).rejects.toThrow(RangeError);
      }
      await expect(drc20.write.transfer({ to: { External: BOB } as any, amount: 1n })).rejects.toThrow(TypeError);
      await expect(drc20.write.approve({ spender: { Contract: "0x12" }, amount: 1n })).rejects.toThrow("32 bytes");
      expect(provider.request).not.toHaveBeenCalled();
      expect(() => drcPrincipal("not an address")).toThrow("Invalid Base58 account");
      expect(() => drcPrincipal(PHOENIX)).toThrow("must encode 96 bytes"); // A Phoenix key isn't an account.
    } finally { wallet.destroy(); }
  });

  it("sends a large amount as a decimal string where JSON.rawJSON is missing", async () => {
    const { rawJSON } = JSON as { rawJSON?: unknown };
    const encodeInputFn = vi.fn((_fn: string, _json: string) => new Uint8Array([1]));
    const drc20 = createDrc20({ contractId: "0x" + "33".repeat(32), driver: { encodeInputFn } as any,
      defaultTx: { privacy: "public" } });
    try {
      Object.assign(JSON, { rawJSON: undefined });
      await drc20.tx.transfer({ to: drcPrincipal(BOB), amount: 9_007_199_254_740_993n });
      await drc20.tx.transfer({ to: drcPrincipal(BOB), amount: 9_007_199_254_740_991n });
      expect(encodeInputFn.mock.calls.map(([, json]) => JSON.parse(json).amount))
        .toEqual(["9007199254740993", 9007199254740991]);
    } finally { Object.assign(JSON, { rawJSON }); }
  });

  it("requires a driver when building a DRC20 contract", () => {
    expect(() =>
      createDrc20({
        contractId: "0x" + "11".repeat(32),
      } as any)
    ).toThrow(/driver or driverUrl is required/i);
  });
});
