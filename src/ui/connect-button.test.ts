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

  it("shows the profile's name in place of the short account, in full in its title", () => {
    const account = "dusk1abcdefghijklmnop";
    const wallet = createMockUiWallet({
      installed: true,
      authorized: true,
      profiles: [{ profileId: "profile:0", account, name: "alice.dusk" }],
    });
    const el = createDuskConnectButton({
      wallet: wallet as any,
      modal: { open() {}, close() {}, destroy() {}, isOpen: () => false } as any,
    });

    document.body.appendChild(el);

    const button = el.shadowRoot!.querySelector("button")!;
    const label = el.shadowRoot!.querySelector<HTMLElement>(".label")!;
    expect(label.textContent).toBe("alice.dusk");
    expect(label.title).toBe("alice.dusk");
    expect(button.textContent).toContain("alice.dusk"); // The accessible name comes from this content.
    expect(button.hasAttribute("aria-label")).toBe(false);

    const long = `${"a".repeat(63)}.dusk`; // Ellipsized by CSS, so kept whole in the DOM.
    wallet.emit({ profiles: [{ profileId: "profile:0", account, name: long }] });
    expect(label.textContent).toBe(long);
    expect(label.title).toBe(long);

    wallet.emit({ authorized: false, profiles: [] });
    expect(label.textContent).toBe("Connect wallet");
    expect(label.title).toBe("");

    wallet.emit({ authorized: true, profiles: [{ profileId: "profile:0", account }] });
    expect(label.textContent).toBe("dusk1a…mnop");
    expect(label.title).toBe("");
  });

  it("hides the network badge until the wallet is connected", () => {
    const wallet = createMockUiWallet({
      installed: true,
      authorized: false,
      accounts: [],
      chainId: "dusk:2",
      node: {
        chainId: "dusk:2",
        nodeUrl: "https://testnet.nodes.dusk.network",
        networkName: "Testnet",
      },
    } as any);
    const el = createDuskConnectButton({
      wallet: wallet as any,
      modal: { open() {}, close() {}, destroy() {}, isOpen: () => false } as any,
    });

    document.body.appendChild(el);

    const net = el.shadowRoot!.querySelector(".net") as HTMLElement;
    expect(net.textContent).toBe("");
    expect(net.style.display).toBe("none");
  });

  it("supports an explicit light theme attribute", () => {
    const el = createDuskConnectButton({ theme: "light" });

    document.body.appendChild(el);

    expect(el.getAttribute("theme")).toBe("light");
  });

  it("opens the modal for missing-wallet clicks", () => {
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
    el.wallet = wallet as any;
    el.modal = modal as any;
    document.body.appendChild(el);

    (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();

    expect(window.open).not.toHaveBeenCalled();
    expect(modal.open).toHaveBeenCalledTimes(1);
  });
});
