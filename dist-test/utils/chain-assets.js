"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USDC_ADDRESS = exports.CHAIN_TO_CAIP2 = void 0;
exports.assetFor = assetFor;
exports.toAtomicString = toAtomicString;
exports.creditsFor = creditsFor;
exports.creditsFromAtomicUsdc = creditsFromAtomicUsdc;
/**
 * Maps an SDK {@link Chain} to its CAIP-2 network identifier, the form the
 * Covenant daemon and the x402 protocol use to name a chain.
 */
exports.CHAIN_TO_CAIP2 = {
    base: "eip155:8453",
    ethereum: "eip155:1",
    arbitrum: "eip155:42161",
    // Solana mainnet-beta genesis hash.
    solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};
/**
 * USDC contract address (EVM) or mint (Solana) per chain. The Base address
 * matches the one used in the Covenant spend-authorization spec.
 */
exports.USDC_ADDRESS = {
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    // Solana mainnet USDC mint.
    solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
/** Decimal places per token, used to convert human amounts to atomic units. */
const TOKEN_DECIMALS = {
    USDC: 6,
    USDT: 6,
    ETH: 18,
    SOL: 9,
};
/**
 * Resolve the on-chain asset identifier (token contract / mint) for a spend.
 * Only USDC has per-chain addresses today; other tokens fall back to their
 * symbol so the daemon still records something meaningful on the audit row.
 */
function assetFor(chain, token) {
    if (token === "USDC")
        return exports.USDC_ADDRESS[chain];
    return token;
}
/**
 * Convert a human-readable token amount (e.g. `0.08` USDC) to its atomic
 * integer value as a decimal string (e.g. `"80000"`). A string is returned so
 * u128 values above JSON's 53-bit integer ceiling survive the wire, matching
 * the Covenant request contract.
 */
function toAtomicString(amount, token) {
    const decimals = TOKEN_DECIMALS[token] ?? 6;
    // Scale via string math on a fixed-decimal representation to avoid float
    // drift (e.g. 0.07 * 1e6 === 70000.00000000001 in IEEE-754).
    const fixed = amount.toFixed(decimals);
    const [whole, frac = ""] = fixed.split(".");
    const atomic = `${whole}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
    return atomic === "" ? "0" : atomic;
}
/**
 * Derive the USD-pegged credit cost of a spend the same way the x402 path
 * does: USDC is treated as a 1:1 USD peg and credits are whole USD cents.
 * Example from the spec: atomic `80000` USDC ($0.08) yields `8` credits.
 */
function creditsFor(humanAmount, token) {
    if (token === "USDC" || token === "USDT") {
        return Math.round(humanAmount * 100);
    }
    // Non-stable tokens have no fixed USD peg here; the caller's per-call cap and
    // capability still apply. Report zero so the budget check is a no-op rather
    // than guessing a price.
    return 0;
}
/**
 * Credits (USD cents) for an atomic USDC amount parsed from an x402 challenge.
 * USDC has 6 decimals, so `atomic / 10000` cents, e.g. `80000` -> `8`.
 */
function creditsFromAtomicUsdc(atomicAmount) {
    const atomic = Number(atomicAmount);
    if (!Number.isFinite(atomic))
        return 0;
    return Math.round(atomic / 10000);
}
