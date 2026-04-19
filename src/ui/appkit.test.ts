import { describe, expect, it, vi } from "vitest";

const { createDuskWalletMock, createDuskConnectModalMock } = vi.hoisted(() => ({
  createDuskWalletMock: vi.fn(),
  createDuskConnectModalMock: vi.fn(),
}));

vi.mock("../wallet.js", () => ({
  createDuskWallet: createDuskWalletMock,
}));

vi.mock("./modal.js", () => ({
  createDuskConnectModal: createDuskConnectModalMock,
}));

import { createDuskConnectKit } from "./appkit.js";

describe("connect kit", () => {
  it("wires wallet, modal, and delegation helpers together", () => {
    const unsubscribe = vi.fn();
    const wallet = {
      subscribe: vi.fn(() => unsubscribe),
      destroy: vi.fn(),
    };
    const modal = {
      open: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
    };

    createDuskWalletMock.mockReturnValue(wallet);
    createDuskConnectModalMock.mockReturnValue(modal);

    const kit = createDuskConnectKit({
      wallet: { autoRefresh: false },
      modal: { appName: "Demo" },
    });

    expect(kit.wallet).toBe(wallet);
    expect(kit.modal).toBe(modal);

    const handler = vi.fn();
    expect(kit.subscribe(handler)).toBe(unsubscribe);
    expect(wallet.subscribe).toHaveBeenCalledWith(handler);

    kit.open();
    kit.close();
    kit.destroy();

    expect(modal.open).toHaveBeenCalledTimes(1);
    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(modal.destroy).toHaveBeenCalledTimes(1);
    expect(wallet.destroy).toHaveBeenCalledTimes(1);
  });
});
