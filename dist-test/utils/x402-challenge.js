"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseX402Challenge = parseX402Challenge;
exports.txSigFromReceipt = txSigFromReceipt;
const chain_assets_js_1 = require("./chain-assets.js");
const PAYMENT_REQUIRED_HEADERS = [
    "PAYMENT-REQUIRED",
    "payment-required",
    "X-Payment-Required",
    "x-payment-required",
];
function decodeBase64Json(value) {
    // Node 18+ exposes Buffer; browsers expose atob. Prefer Buffer when present.
    const json = typeof Buffer !== "undefined"
        ? Buffer.from(value, "base64").toString("utf-8")
        : atob(value);
    return JSON.parse(json);
}
function readHeader(response) {
    for (const name of PAYMENT_REQUIRED_HEADERS) {
        const value = response.headers.get(name);
        if (value)
            return value;
    }
    return null;
}
/**
 * Parse the x402 payment challenge from a 402 response. Tries the
 * `PAYMENT-REQUIRED` header first (x402 v2, base64-encoded JSON), falling back
 * to legacy header names, then to the response body JSON.
 *
 * @param response - The 402 response. Its body may be consumed.
 * @param preferredChain - When the challenge offers several options, prefer the
 *   one whose network matches this SDK chain.
 * @returns the {@link ParsedChallenge}, or `null` when no challenge is found.
 */
async function parseX402Challenge(response, preferredChain) {
    let payload = null;
    const header = readHeader(response);
    if (header) {
        try {
            payload = decodeBase64Json(header);
        }
        catch {
            payload = null;
        }
    }
    if (!payload) {
        try {
            payload = (await response.clone().json());
        }
        catch {
            return null;
        }
    }
    const accepts = payload?.accepts;
    if (!Array.isArray(accepts) || accepts.length === 0)
        return null;
    const preferredNetwork = preferredChain
        ? chain_assets_js_1.CHAIN_TO_CAIP2[preferredChain]
        : undefined;
    const chosen = (preferredNetwork &&
        accepts.find((a) => a.network === preferredNetwork)) ||
        accepts[0];
    if (!chosen?.network || !chosen?.amount || !chosen?.asset)
        return null;
    return {
        network: chosen.network,
        asset: chosen.asset,
        amount: chosen.amount,
        destination: chosen.payTo,
    };
}
/**
 * Extract the on-chain transaction signature from an x402 payment receipt.
 *
 * Receipts are documented as base64-encoded JSON carrying a `txHash`; some
 * servers also use `transaction` or `tx_sig`. When the receipt cannot be
 * decoded, the raw receipt string itself is returned so the settlement still
 * carries a correlatable value.
 */
function txSigFromReceipt(receipt) {
    try {
        const decoded = decodeBase64Json(receipt);
        const sig = decoded?.txHash ?? decoded?.transaction ?? decoded?.tx_sig;
        if (typeof sig === "string" && sig.length > 0)
            return sig;
    }
    catch {
        // Not base64 JSON — fall through to the raw receipt.
    }
    return receipt;
}
