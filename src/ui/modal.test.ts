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
    expect(primary.textContent).toBe("Install Wallet");

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
    expect((document.querySelector("#mconnectTitle") as HTMLElement).textContent).toBe(
      "Connect My <b>dApp</b>"
    );

    (document.querySelector("#dwcPrimary") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(wallet.connect).toHaveBeenCalledTimes(1);
    expect(modal.isOpen()).toBe(false);
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
