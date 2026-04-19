import { describe, expect, it } from "vitest";

import { networkLabel, shortenMiddle, walletStatus } from "./shared.js";

describe("ui shared helpers", () => {
  it("computes wallet status from wallet state", () => {
    expect(walletStatus(null)).toBe("missing");
    expect(walletStatus({ installed: false } as any)).toBe("missing");
    expect(walletStatus({ installed: true, authorized: false, accounts: [] } as any)).toBe(
      "disconnected"
    );
    expect(walletStatus({ installed: true, authorized: true, accounts: [] } as any)).toBe("locked");
    expect(walletStatus({ installed: true, authorized: true, accounts: ["dusk1"] } as any)).toBe(
      "connected"
    );
  });

  it("picks a display label for the active network", () => {
    expect(networkLabel({ node: { networkName: "Testnet" } } as any)).toBe("Testnet");
    expect(networkLabel({ chainId: "dusk:2", node: null } as any)).toBe("dusk:2");
    expect(networkLabel(null)).toBe("");
  });

  it("shortens long account strings but keeps short ones intact", () => {
    expect(shortenMiddle("abcdef", 2, 2)).toBe("abcdef");
    expect(shortenMiddle("abcdefghijklmnopqrstuvwxyz", 4, 4)).toBe("abcd…wxyz");
  });
});
