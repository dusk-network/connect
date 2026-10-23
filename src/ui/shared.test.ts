import { describe, expect, it } from "vitest";

import { networkLabel, shortenMiddle, shownProfile, walletStatus } from "./shared.js";

describe("ui shared helpers", () => {
  it("computes wallet status from wallet state", () => {
    expect(walletStatus(null)).toBe("missing");
    expect(walletStatus({ installed: false } as any)).toBe("missing");
    expect(walletStatus({ installed: true, authorized: false, profiles: [] } as any)).toBe(
      "disconnected"
    );
    expect(walletStatus({ installed: true, authorized: true, profiles: [] } as any)).toBe("locked");
    expect(walletStatus({ installed: true, authorized: true, profiles: [{ profileId: "profile:0", account: "dusk1" }] } as any)).toBe(
      "connected"
    );
  });

  it("picks one profile record to show", () => {
    const first = { profileId: "profile:0", account: "dusk1first", name: "first.dusk" };
    const second = { profileId: "profile:1", account: "dusk1second" };
    expect(shownProfile({ selectedProfile: second, profiles: [first, second] } as any)).toBe(second);
    expect(shownProfile({ selectedProfile: { profileId: "x", account: "" }, profiles: [first] } as any)).toBe(first);
    expect(shownProfile({ selectedProfile: null, profiles: [] } as any)).toBeNull();
    expect(shownProfile(null)).toBeNull();
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
