import { describe, expect, it } from "vitest";

import {
  DUSK_WALLET_CHROMIUM_URL,
  DUSK_WALLET_FIREFOX_URL,
  PIEWALLET_CHROMIUM_URL,
  PIEWALLET_ICON_URL,
  detectDuskWalletInstallPlatform,
  getDuskWalletInstallTargets,
} from "./installOptions.js";

describe("wallet install options", () => {
  it("detects Firefox and Chromium browser families", () => {
    expect(
      detectDuskWalletInstallPlatform(
        "Mozilla/5.0 Firefox/128.0"
      )
    ).toBe("firefox");

    expect(
      detectDuskWalletInstallPlatform(
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
      )
    ).toBe("chromium");

    expect(detectDuskWalletInstallPlatform("Mozilla/5.0 Safari/605.1.15")).toBe("unknown");
  });

  it("returns Chromium install targets for Chromium browsers", () => {
    const targets = getDuskWalletInstallTargets({
      userAgent: "Mozilla/5.0 Chrome/126.0 Safari/537.36",
    });

    expect(targets.map((target) => target.url)).toEqual([
      DUSK_WALLET_CHROMIUM_URL,
      PIEWALLET_CHROMIUM_URL,
    ]);
    expect(targets[1]).toMatchObject({
      name: "Piewallet",
      description: "Official Pieswap wallet for DuskDS & DuskEVM.",
      iconUrl: PIEWALLET_ICON_URL,
    });
  });

  it("returns Firefox install targets for Firefox browsers", () => {
    const targets = getDuskWalletInstallTargets({
      userAgent: "Mozilla/5.0 Firefox/128.0",
    });

    expect(targets.map((target) => target.url)).toEqual([DUSK_WALLET_FIREFOX_URL]);
  });

});
