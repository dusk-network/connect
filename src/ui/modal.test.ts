// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDuskConnectModal } from "./modal.js";
import {
  DUSK_WALLET_CHROMIUM_URL,
  DUSK_WALLET_FIREFOX_URL,
  PIEWALLET_CHROMIUM_URL,
  PIEWALLET_ICON_URL,
} from "./installOptions.js";
import { createMockUiWallet } from "../test/mocks.js";

const originalUserAgent = navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value,
  });
}

describe("connect modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("open", vi.fn());
    setUserAgent("Mozilla/5.0 AppleWebKit/537.36 Chrome/126.0 Safari/537.36");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setUserAgent(originalUserAgent);
    vi.unstubAllGlobals();
  });

  it("opens in missing-wallet mode with Chromium install options and refreshes discovery", async () => {
    const wallet = createMockUiWallet({ installed: false, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    const primary = document.querySelector("#dwcPrimary") as HTMLButtonElement;
    const section = document.querySelector("#dwcSectionLabel") as HTMLElement;
    const installButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-action="install-wallet"]'),
    ];

    expect(section.textContent).toBe("Install");
    expect(primary.textContent).toBe("Refresh wallets");
    expect(installButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("Dusk Wallet"),
      expect.stringContaining("Piewallet"),
    ]);
    expect(installButtons[1]?.textContent).toContain(
      "Official Pieswap wallet for DuskDS & DuskEVM."
    );
    expect(installButtons[1]?.querySelector("img")?.getAttribute("src")).toBe(PIEWALLET_ICON_URL);

    installButtons[0]!.click();

    expect(window.open).toHaveBeenCalledWith(
      DUSK_WALLET_CHROMIUM_URL,
      "_blank",
      "noopener,noreferrer"
    );

    installButtons[1]!.click();

    expect(window.open).toHaveBeenCalledWith(
      PIEWALLET_CHROMIUM_URL,
      "_blank",
      "noopener,noreferrer"
    );

    primary.click();
    await Promise.resolve();

    expect(wallet.discoverProviders).toHaveBeenCalledWith({ timeoutMs: 250 });
  });

  it("shows the Firefox add-ons install option in Firefox", () => {
    setUserAgent("Mozilla/5.0 Firefox/128.0");

    const wallet = createMockUiWallet({ installed: false, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    const installButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-action="install-wallet"]'),
    ];

    expect(installButtons).toHaveLength(1);
    expect(installButtons[0]?.textContent).toContain("Dusk Wallet");

    installButtons[0]!.click();

    expect(window.open).toHaveBeenCalledWith(
      DUSK_WALLET_FIREFOX_URL,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("does not open unsafe tampered install URLs", () => {
    const wallet = createMockUiWallet({ installed: false, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    const installButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-action="install-wallet"]'),
    ];

    installButtons[0]!.setAttribute("data-install-url", "data:text/html,blocked");
    installButtons[0]!.click();

    expect(window.open).not.toHaveBeenCalled();
  });

  it("connects and auto-closes when the wallet becomes connected", async () => {
    const wallet = createMockUiWallet({ installed: true, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any, {
      appName: "My <b>dApp</b>",
    });

    modal.open();
    expect((document.querySelector("#dconnectTitle") as HTMLElement).textContent).toBe(
      "Connect My <b>dApp</b>"
    );

    (document.querySelector("#dwcPrimary") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(wallet.connect).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);
  });

  it("does not double-prefix app names that already start with Connect", () => {
    const wallet = createMockUiWallet({ installed: true, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any, {
      appName: "Connect Demo",
    });

    modal.open();

    expect((document.querySelector("#dconnectTitle") as HTMLElement).textContent).toBe(
      "Connect Demo"
    );
  });

  it("applies an explicit light theme to the overlay", () => {
    const wallet = createMockUiWallet({ installed: true, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any, {
      theme: "light",
    });

    modal.open();

    expect((document.querySelector(".dconnect-overlay") as HTMLElement).dataset.theme).toBe(
      "light"
    );
  });

  it("uses the Dusk logo mark for Dusk Wallet rows even when an icon is supplied", () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: false,
      accounts: [],
      availableProviders: [
        {
          uuid: "wallet.dusk.extension",
          name: "Dusk Wallet",
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Ctext%3ED%3C/text%3E%3C/svg%3E",
          rdns: "network.dusk.wallet",
        },
      ],
    });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    expect(document.querySelector(".dconnect-provider-mark")).toBeTruthy();
    expect(document.querySelector(".dconnect-provider-icon")).toBeNull();
  });

  it("uses provider initials for iconless non-Dusk wallet rows", () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: false,
      accounts: [],
      availableProviders: [
        {
          uuid: "wallet.aurora.demo",
          name: "Aurora Wallet",
          icon: "",
          rdns: "demo.aurora.wallet",
        },
      ],
    });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    const initial = document.querySelector(".dconnect-provider-initial");
    expect(initial?.textContent).toBe("A");
    expect(document.querySelector(".dconnect-provider-dusk")).toBeNull();
    expect(document.querySelector(".dconnect-provider-icon")).toBeNull();
  });

  it("supports copying and disconnecting when already connected", async () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: true,
      accounts: ["dusk1abcdefghijklmnop"],
      selectedAddress: "dusk1abcdefghijklmnop",
      node: {
        chainId: "dusk:2",
        nodeUrl: "https://testnet.nodes.dusk.network",
        networkName: "Testnet",
      },
    });
    const modal = createDuskConnectModal(wallet as any);

    modal.open();

    const copy = document.querySelector("#dwcCopy") as HTMLButtonElement;
    const primary = document.querySelector("#dwcPrimary") as HTMLButtonElement;

    expect(copy.hidden).toBe(false);
    expect(primary.textContent).toBe("Disconnect");

    copy.click();
    await Promise.resolve();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("dusk1abcdefghijklmnop");

    primary.click();
    await Promise.resolve();

    expect(wallet.disconnect).toHaveBeenCalledTimes(1);
  });
});
