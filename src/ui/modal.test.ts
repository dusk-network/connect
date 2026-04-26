// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDuskConnectModal } from "./modal.js";
import { createMockUiWallet } from "../test/mocks.js";

describe("connect modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("open", vi.fn());

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens in missing-wallet mode and routes install clicks to the install url", async () => {
    const wallet = createMockUiWallet({ installed: false, authorized: false, accounts: [] });
    const modal = createDuskConnectModal(wallet as any, {
      installUrl: "https://wallet.example/install",
    });

    modal.open();

    const primary = document.querySelector("#dwcPrimary") as HTMLButtonElement;
    expect(primary.textContent).toBe("Install wallet");

    primary.click();

    expect(window.open).toHaveBeenCalledWith(
      "https://wallet.example/install",
      "_blank",
      "noopener,noreferrer"
    );
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
