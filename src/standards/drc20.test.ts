import { describe, expect, it, vi } from "vitest";

import { asDrc20, createDrc20 } from "./drc20.js";

describe("DRC20 helpers", () => {
  it("adapts a generic contract facade into ergonomic reads and tx displays", async () => {
    const contract = {
      call: {
        name: vi.fn(async () => "Token"),
        symbol: vi.fn(async () => "TKN"),
        decimals: vi.fn(async () => "9"),
        total_supply: vi.fn(async () => "1000"),
        balance_of: vi.fn(async () => "7"),
        allowance: vi.fn(async () => "3"),
      },
      tx: {
        transfer: vi.fn(async (_args, overrides) => ({ overrides })),
        approve: vi.fn(async (_args, overrides) => ({ overrides })),
        transfer_from: vi.fn(async (_args, overrides) => ({ overrides })),
      },
      write: {
        transfer: vi.fn(async (_args, overrides) => ({ overrides })),
        approve: vi.fn(async (_args, overrides) => ({ overrides })),
        transfer_from: vi.fn(async (_args, overrides) => ({ overrides })),
      },
    } as any;

    const drc20 = asDrc20(contract);
    await expect(drc20.read.decimals()).resolves.toBe(9);
    await expect(drc20.read.balanceOf({ account: { External: "dusk1acct" } })).resolves.toBe("7");

    await drc20.tx.approve({
      spender: { External: "dusk1spender" },
      value: "18446744073709551615",
    });

    expect(contract.tx.approve).toHaveBeenCalledWith(
      {
        spender: { External: "dusk1spender" },
        value: "18446744073709551615",
      },
      expect.objectContaining({
        display: expect.objectContaining({
          standard: "DRC20",
          op: "approve",
          isMax: true,
        }),
      })
    );
  });

  it("requires a driver when building a DRC20 contract", () => {
    expect(() =>
      createDrc20({
        contractId: "0x" + "11".repeat(32),
      } as any)
    ).toThrow(/driver or driverUrl is required/i);
  });
});
