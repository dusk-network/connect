// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDuskConnectButton,
  defineDuskConnectButton,
  DuskConnectButtonElement,
} from "./connect-button.js";
import { createMockUiWallet } from "../test/mocks.js";

describe("connect button", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("open", vi.fn());
    defineDuskConnectButton();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders with external wallet/modal instances and opens the modal on click", async () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: false,
      accounts: [],
    });
    const modal = {
      open: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      isOpen: vi.fn(() => false),
    };

    const el = createDuskConnectButton({
      wallet: wallet as any,
      modal: modal as any,
      connectText: "Connect Dusk",
    });
    const seen: any[] = [];
    el.addEventListener("dusk-state", (event) => {
      seen.push((event as CustomEvent).detail);
    });

    document.body.appendChild(el);
    await Promise.resolve();

    const shadow = el.shadowRoot!;
    expect(shadow.querySelector(".label")?.textContent).toBe("Connect Dusk");

    (shadow.querySelector("button") as HTMLButtonElement).click();
    expect(modal.open).toHaveBeenCalledTimes(1);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("updates label and network badge when the wallet connects", () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: false,
      accounts: [],
    });
    const el = createDuskConnectButton({
      wallet: wallet as any,
      modal: { open() {}, close() {}, destroy() {}, isOpen: () => false } as any,
    });

    document.body.appendChild(el);

    wallet.emit({
      authorized: true,
      accounts: ["dusk1abcdefghijklmnop"],
      selectedAddress: "dusk1abcdefghijklmnop",
      node: {
        chainId: "dusk:1",
        nodeUrl: "https://nodes.dusk.network",
        networkName: "Mainnet",
      },
    });

    const shadow = el.shadowRoot!;
    expect(shadow.querySelector(".label")?.textContent).toContain("dusk1a");
    expect(shadow.querySelector(".label")?.textContent).toContain("mnop");
    expect(shadow.querySelector(".net")?.textContent).toBe("Mainnet");
  });

  it("routes missing-wallet clicks to installUrl instead of opening the modal", () => {
    const wallet = createMockUiWallet({
      installed: false,
      authorized: false,
      accounts: [],
    });
    const modal = {
      open: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      isOpen: vi.fn(() => false),
    };

    const el = document.createElement("dusk-connect-button") as DuskConnectButtonElement;
    el.setAttribute("install-url", "https://wallet.example/install");
    el.wallet = wallet as any;
    el.modal = modal as any;
    document.body.appendChild(el);

    (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();

    expect(window.open).toHaveBeenCalledWith(
      "https://wallet.example/install",
      "_blank",
      "noopener,noreferrer"
    );
    expect(modal.open).not.toHaveBeenCalled();
  });
});
