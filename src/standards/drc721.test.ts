import { describe, expect, it, vi } from "vitest";

import { asDrc721, createDrc721 } from "./drc721.js";

describe("DRC721 helpers", () => {
  it("adapts a generic contract facade into ergonomic reads and tx displays", async () => {
    const contract = {
      call: {
        name: vi.fn(async () => "Collection"),
        symbol: vi.fn(async () => "COLL"),
        base_uri: vi.fn(async () => "ipfs://base"),
        total_supply: vi.fn(async () => "100"),
        balance_of: vi.fn(async () => "2"),
        owner_of: vi.fn(async () => ({ External: "dusk1owner" })),
        token_uri: vi.fn(async () => "ipfs://token"),
        get_approved: vi.fn(async () => ({ External: "dusk1approved" })),
        is_approved_for_all: vi.fn(async () => true),
      },
      tx: {
        approve: vi.fn(async (_args, overrides) => ({ overrides })),
        set_approval_for_all: vi.fn(async (_args, overrides) => ({ overrides })),
        transfer_from: vi.fn(async (_args, overrides) => ({ overrides })),
      },
      write: {
        approve: vi.fn(async (_args, overrides) => ({ overrides })),
        set_approval_for_all: vi.fn(async (_args, overrides) => ({ overrides })),
        transfer_from: vi.fn(async (_args, overrides) => ({ overrides })),
      },
    } as any;

    const drc721 = asDrc721(contract);
    await expect(drc721.read.baseUri()).resolves.toBe("ipfs://base");
    await expect(drc721.read.isApprovedForAll({
      owner: { External: "dusk1owner" },
      operator: { External: "dusk1operator" },
    })).resolves.toBe(true);

    await drc721.write.transferFrom(
      {
        from: { External: "dusk1owner" },
        to: { External: "dusk1dest" },
        token_id: "9",
      },
      { display: { custom: true } }
    );

    expect(contract.write.transfer_from).toHaveBeenCalledWith(
      {
        from: { External: "dusk1owner" },
        to: { External: "dusk1dest" },
        token_id: "9",
      },
      expect.objectContaining({
        display: expect.objectContaining({
          standard: "DRC721",
          op: "transfer_from",
          tokenId: "9",
          custom: true,
        }),
      })
    );
  });

  it("requires a driver when building a DRC721 contract", () => {
    expect(() =>
      createDrc721({
        contractId: "0x" + "22".repeat(32),
      } as any)
    ).toThrow(/driver or driverUrl is required/i);
  });
});
