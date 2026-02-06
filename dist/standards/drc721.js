import { createDuskContract } from "../contract.js";
import { fetchWasmDataDriver } from "../driver.js";
export const DRC721_METHOD_SIGS = {
    // Views
    name: "name()",
    symbol: "symbol()",
    base_uri: "base_uri()",
    token_uri: "token_uri(token_id: u64)",
    total_supply: "total_supply()",
    balance_of: "balance_of(account: Account)",
    owner_of: "owner_of(token_id: u64)",
    get_approved: "get_approved(token_id: u64)",
    is_approved_for_all: "is_approved_for_all(owner: Account, operator: Account)",
    // State-changing
    approve: "approve(approved: Account, token_id: u64)",
    set_approval_for_all: "set_approval_for_all(operator: Account, approved: bool)",
    transfer_from: "transfer_from(from: Account, to: Account, token_id: u64)",
};
function mergeDisplay(base, extra) {
    if (extra && typeof extra === "object")
        return { ...base, ...extra };
    if (extra == null)
        return base;
    return { ...base, display: extra };
}
function buildDrc721Display(op, args) {
    const a = args && typeof args === "object" ? args : {};
    return {
        standard: "DRC721",
        op,
        ...(op === "approve" ? { approved: a.approved, tokenId: String(a.token_id ?? "") } : {}),
        ...(op === "set_approval_for_all" ? { operator: a.operator, approved: Boolean(a.approved) } : {}),
        ...(op === "transfer_from" ? { from: a.from, to: a.to, tokenId: String(a.token_id ?? "") } : {}),
    };
}
export function asDrc721(contract) {
    return {
        contract,
        read: {
            name: () => contract.call["name"](),
            symbol: () => contract.call["symbol"](),
            baseUri: () => contract.call["base_uri"](),
            totalSupply: async (callOpts) => String(await contract.call["total_supply"](null, callOpts)),
            balanceOf: async (args, callOpts) => String(await contract.call["balance_of"](args, callOpts)),
            ownerOf: async (args, callOpts) => await contract.call["owner_of"](args, callOpts),
            tokenUri: async (args, callOpts) => String(await contract.call["token_uri"](args, callOpts)),
            getApproved: async (args, callOpts) => await contract.call["get_approved"](args, callOpts),
            isApprovedForAll: async (args, callOpts) => Boolean(await contract.call["is_approved_for_all"](args, callOpts)),
        },
        tx: {
            approve: async (args, overrides) => await contract.tx["approve"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("approve", args), overrides?.display),
            }),
            setApprovalForAll: async (args, overrides) => await contract.tx["set_approval_for_all"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("set_approval_for_all", args), overrides?.display),
            }),
            transferFrom: async (args, overrides) => await contract.tx["transfer_from"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("transfer_from", args), overrides?.display),
            }),
        },
        write: {
            approve: async (args, overrides) => await contract.write["approve"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("approve", args), overrides?.display),
            }),
            setApprovalForAll: async (args, overrides) => await contract.write["set_approval_for_all"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("set_approval_for_all", args), overrides?.display),
            }),
            transferFrom: async (args, overrides) => await contract.write["transfer_from"](args, {
                ...(overrides ?? {}),
                display: mergeDisplay(buildDrc721Display("transfer_from", args), overrides?.display),
            }),
        },
    };
}
export function createDrc721(opts) {
    const driver = opts.driver ?? (opts.driverUrl ? fetchWasmDataDriver(opts.driverUrl) : null);
    if (!driver)
        throw new Error("createDrc721: driver or driverUrl is required");
    const contract = createDuskContract({
        ...opts,
        driver,
        name: opts.name ?? "DRC721",
        methodSigs: { ...DRC721_METHOD_SIGS, ...(opts.methodSigs ?? {}) },
    });
    return asDrc721(contract);
}
//# sourceMappingURL=drc721.js.map