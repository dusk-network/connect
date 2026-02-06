import { createDuskContract } from "../contract.js";
import { fetchWasmDataDriver } from "../driver.js";
export const DRC20_METHOD_SIGS = {
    // Views
    name: "name()",
    symbol: "symbol()",
    decimals: "decimals()",
    total_supply: "total_supply()",
    balance_of: "balance_of(account: Account)",
    allowance: "allowance(owner: Account, spender: Account)",
    // State-changing
    transfer: "transfer(to: Account, value: u64)",
    approve: "approve(spender: Account, value: u64)",
    transfer_from: "transfer_from(owner: Account, to: Account, value: u64)",
};
function mergeDisplay(base, extra) {
    if (extra && typeof extra === "object")
        return { ...base, ...extra };
    if (extra == null)
        return base;
    return { ...base, display: extra };
}
function isMaxU64(v) {
    try {
        return BigInt(String(v ?? "")) === 18446744073709551615n;
    }
    catch {
        return false;
    }
}
function buildDrc20Display(op, args) {
    const a = args && typeof args === "object" ? args : {};
    return {
        standard: "DRC20",
        op,
        ...(op === "transfer" ? { to: a.to, valueUnits: String(a.value ?? "") } : {}),
        ...(op === "approve"
            ? {
                spender: a.spender,
                valueUnits: String(a.value ?? ""),
                isMax: isMaxU64(a.value),
            }
            : {}),
        ...(op === "transfer_from"
            ? { owner: a.owner, to: a.to, valueUnits: String(a.value ?? "") }
            : {}),
    };
}
export function asDrc20(contract) {
    return {
        contract,
        read: {
            name: () => contract.call["name"](),
            symbol: () => contract.call["symbol"](),
            decimals: async () => Number(await contract.call["decimals"]()),
            totalSupply: async (callOpts) => String(await contract.call["total_supply"](null, callOpts)),
            balanceOf: async (args, callOpts) => String(await contract.call["balance_of"](args, callOpts)),
            allowance: async (args, callOpts) => String(await contract.call["allowance"](args, callOpts)),
        },
        tx: {
            transfer: async (args, overrides) => await contract.tx["transfer"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("transfer", args), overrides?.display),
            }),
            approve: async (args, overrides) => await contract.tx["approve"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("approve", args), overrides?.display),
            }),
            transferFrom: async (args, overrides) => await contract.tx["transfer_from"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("transfer_from", args), overrides?.display),
            }),
        },
        write: {
            transfer: async (args, overrides) => await contract.write["transfer"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("transfer", args), overrides?.display),
            }),
            approve: async (args, overrides) => await contract.write["approve"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("approve", args), overrides?.display),
            }),
            transferFrom: async (args, overrides) => await contract.write["transfer_from"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc20Display("transfer_from", args), overrides?.display),
            }),
        },
    };
}
export function createDrc20(opts) {
    const driver = opts.driver ?? (opts.driverUrl ? fetchWasmDataDriver(opts.driverUrl) : null);
    if (!driver)
        throw new Error("createDrc20: driver or driverUrl is required");
    const contract = createDuskContract({
        ...opts,
        driver,
        name: opts.name ?? "DRC20",
        methodSigs: { ...DRC20_METHOD_SIGS, ...(opts.methodSigs ?? {}) },
    });
    return asDrc20(contract);
}
//# sourceMappingURL=drc20.js.map