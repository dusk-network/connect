// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createDuskConnectModal } from "./modal.js";
import {
  DUSK_WALLET_CHROMIUM_URL,
  DUSK_WALLET_FIREFOX_URL,
  PIEWALLET_CHROMIUM_URL,
  PIEWALLET_ICON_URL,
} from "./installOptions.js";
import { createMockProvider, createMockProviderInfo, createMockUiWallet } from "../test/mocks.js";
import { makeDuskAnnounceProviderEvent } from "../discovery.js";
import { createDuskWallet } from "../wallet.js";

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
    expect(document.querySelector<HTMLElement>("#dwcProviderNotice")?.hidden).toBe(true);
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

  it("keeps the first UUID entry selectable when a duplicate arrives before selection", async () => {
    const info = createMockProviderInfo({ uuid: "first", name: "First Wallet" });
    const first = createMockProvider();
    const later = createMockProvider();
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false, rememberLastUsedProvider: false });
    const modal = createDuskConnectModal(wallet, { closeOnConnect: false });
    onTestFinished(() => { modal.destroy(); wallet.destroy(); });
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: first }));
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: { ...info, uuid: "other" }, provider: createMockProvider() }));
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: { ...info, name: "Later Wallet" }, provider: later }));
    await wallet.ready();
    expect(wallet.provider).toBeNull(); // Two distinct UUIDs still require a choice.
    modal.open();
    const select = vi.spyOn(wallet, "selectProvider");
    const row = document.querySelector<HTMLButtonElement>('[data-provider-id="first"]')!;
    expect(row.disabled).toBe(false);
    expect(row.textContent).toContain("First Wallet");
    expect(row.textContent).not.toContain("Later Wallet");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector("#dwcProviderNotice")?.textContent).toContain("self-reported, not verified");
    row.click();
    await select.mock.results[0]!.value;
    expect(wallet.provider).toBe(first);
    expect(document.querySelector<HTMLButtonElement>("#dwcPrimary")?.disabled).toBe(false);
    expect(later.request).not.toHaveBeenCalled();
    expect(later.on).not.toHaveBeenCalled();
  });

  it("keeps the first provider connected and selectable without adopting duplicate branding", async () => {
    const info = createMockProviderInfo({ uuid: "chosen", name: "Chosen Wallet" });
    const selected = createMockProvider({ accounts: ["chosen-account"] });
    const impostor = createMockProvider({ accounts: ["scam-account"], authorized: true });
    const wallet = createDuskWallet({ autoRefresh: false, waitForProvider: false, rememberLastUsedProvider: false });
    const modal = createDuskConnectModal(wallet, { closeOnConnect: false });
    onTestFinished(() => { modal.destroy(); wallet.destroy(); });
    await wallet.ready();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: selected }));
    modal.open();
    const primary = document.querySelector<HTMLButtonElement>("#dwcPrimary")!;
    const connect = vi.spyOn(wallet, "connect");
    const disconnect = vi.spyOn(wallet, "disconnect");
    const select = vi.spyOn(wallet, "selectProvider");
    primary.click();
    await connect.mock.results[0]!.value;
    expect(wallet.state.authorized).toBe(true);
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: { ...info, name: "Scam Wallet" }, provider: impostor }));
    expect(wallet.provider).toBe(selected);
    expect(primary.disabled).toBe(false);
    expect(primary.textContent).toBe("Disconnect");
    expect(document.querySelector("#dwcWallet")?.textContent).toBe("Chosen Wallet");
    expect(document.querySelector("#dwcConflicts")).toBeNull();
    const row = document.querySelector<HTMLButtonElement>('[data-provider-id="chosen"]')!;
    expect(row.disabled).toBe(false);
    expect(row.textContent).toContain("Selected");
    expect(row.textContent).not.toContain("Conflict");
    row.click();
    await select.mock.results[0]!.value;
    expect(wallet.provider).toBe(selected);
    expect(impostor.request).not.toHaveBeenCalled();
    primary.click();
    await disconnect.mock.results[0]!.value;
    expect(wallet.state.authorized).toBe(false);
    expect(primary.disabled).toBe(false);
    primary.click();
    await connect.mock.results[1]!.value;
    expect(wallet.state.authorized).toBe(true);
    expect(wallet.provider).toBe(selected);
    expect(impostor.request).not.toHaveBeenCalled();
  });

  it("marks a metadata-less supplied provider selected when its own metadata arrives", async () => {
    const provider = createMockProvider();
    const info = createMockProviderInfo({ uuid: "supplied", name: "Supplied Wallet" });
    const wallet = createDuskWallet({ provider, autoRefresh: false, rememberLastUsedProvider: false });
    const modal = createDuskConnectModal(wallet);
    onTestFinished(() => { modal.destroy(); wallet.destroy(); });
    await wallet.ready();
    modal.open();
    expect(wallet.state.providerId).toBeNull();
    expect(wallet.providerInfo).toBeNull();
    const epoch = wallet.selectionEpoch;

    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider }));

    expect(wallet.provider).toBe(provider);
    expect(wallet.selectionEpoch).toBe(epoch);
    expect(wallet.providerInfo).toEqual(info);
    expect(wallet.state.providerId).toBe(info.uuid);
    expect(document.querySelector("#dwcWallet")?.textContent).toBe(info.name);
    const row = document.querySelector('[data-provider-id="supplied"]')!;
    expect(row.getAttribute("data-selected")).toBe("true");
    expect(row.querySelector(".dconnect-provider-tag")?.textContent).toBe("Selected");
  });

  it("does not label a metadata-less chosen provider with a colliding object's metadata", async () => {
    const selected = createMockProvider({ accounts: ["chosen-account"], authorized: true });
    const info = createMockProviderInfo({ uuid: "collision", name: "Scam Wallet" });
    const wallet = createDuskWallet({ provider: selected, autoRefresh: false });
    const modal = createDuskConnectModal(wallet, { closeOnConnect: false });
    onTestFinished(() => { modal.destroy(); wallet.destroy(); });
    await wallet.ready();
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info, provider: createMockProvider() }));
    window.dispatchEvent(makeDuskAnnounceProviderEvent({ info: { ...info, name: "Chosen Wallet" }, provider: selected }));
    modal.open();
    expect(wallet.provider).toBe(selected);
    expect(document.querySelector("#dwcWallet")?.textContent).toBe("Selected wallet");
    expect(document.querySelector("#dwcStatus")?.textContent).toBe("Connected");
    expect(document.querySelector<HTMLButtonElement>("#dwcPrimary")?.disabled).toBe(false);
    expect(document.querySelector('[data-provider-id="collision"]')?.getAttribute("data-selected")).toBe("false");
    expect(document.querySelector("#dwcConflicts")).toBeNull();
    expect(document.querySelector<HTMLElement>("#dwcProviderNotice")?.hidden).toBe(false);
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
    onTestFinished(() => modal.destroy()); // Cancel the pending close timer before jsdom teardown.

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

  it.each([
    { name: "Dusk Wallet" },
    { rdns: "network.dusk.wallet" },
    { rdns: "evil.dusk.wallet" },
    { name: "Piewallet" },
    { name: "Pie Wallet" },
    { rdns: "evil.piewallet.example" },
    { rdns: "evil.pieswap.example" },
    { uuid: "evil-piewallet-instance" },
    { uuid: "evil-pieswap-instance" },
    { rdns: "evil.harbor.example" },
  ].flatMap(claim => ["", "data:image/png;base64,AA=="].map(icon => ({ ...claim, icon }))))(
    "does not award SDK branding to self-reported metadata: %j",
    (claim) => {
      const info = { uuid: "unverified", name: "Example Wallet", rdns: "com.example.wallet", ...claim };
      const wallet = createMockUiWallet({
        installed: true, authorized: false, accounts: [], availableProviders: [info],
      });
      const modal = createDuskConnectModal(wallet as any);
      onTestFinished(() => modal.destroy());
      modal.open();

      const row = document.querySelector<HTMLButtonElement>('[data-action="select-provider"]')!;
      expect(row.querySelector(".dconnect-provider-dusk")).toBeNull();
      expect(row.querySelector(".dconnect-provider-name")?.textContent).toBe(info.name);
      expect(row.querySelector(".dconnect-provider-rdns")?.textContent).toBe(info.rdns);
      if (info.icon) {
        expect(row.querySelector("img")?.getAttribute("src")).toBe(info.icon);
        expect(row.querySelector(".dconnect-provider-initial")).toBeNull();
      } else {
        expect(row.querySelector("img")).toBeNull();
        const initial = row.querySelector<HTMLElement>(".dconnect-provider-initial")!;
        expect(initial.textContent).toBe(info.name[0]);
        expect(initial.style.getPropertyValue("--dconnect-provider-accent")).toBe("#71B1FF");
      }
      const notice = document.querySelector<HTMLElement>("#dwcProviderNotice")!;
      expect(notice.hidden).toBe(false);
      expect(notice.textContent).toContain("self-reported, not verified");
      row.click();
      expect(wallet.selectProvider).toHaveBeenCalledWith(info.uuid);
    }
  );

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
