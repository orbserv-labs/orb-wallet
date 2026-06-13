"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbWallet = void 0;
const http_js_1 = require("./utils/http.js");
const covenant_js_1 = require("./utils/covenant.js");
const wallet_js_1 = require("./modules/wallet.js");
const x402_js_1 = require("./modules/x402.js");
/** Default API base URL. Override via `OrbWalletOptions.baseUrl`. */
const DEFAULT_BASE_URL = "https://api.orbserv.co/v1";
/**
 * Main entry point for the `@orbserv-labs/orb-wallet` SDK.
 *
 * Construct a single instance per application and reuse it.
 *
 * @example
 * ```typescript
 * import { OrbWallet } from '@orbserv-labs/orb-wallet'
 *
 * const orb = new OrbWallet({ apiKey: process.env.ORB_API_KEY! })
 *
 * // Create a wallet
 * const wallet = await orb.wallet.create({
 *   name: "my-agent",
 *   chains: ["solana", "base", "ethereum", "arbitrum"],
 *   policy: { dailyLimit: 50, maxPerTx: 10 }
 * })
 *
 * // Discover x402 services
 * const services = await orb.x402.discover({ category: "inference" })
 * ```
 */
class OrbWallet {
    /**
     * @param options.apiKey  - Your orbserv API key (required).
     * @param options.baseUrl - Override the API base URL. Defaults to
     *   `https://api.orbserv.co/v1`.
     *
     * @throws {TypeError} When `apiKey` is missing or empty.
     */
    constructor(options) {
        if (!options.apiKey) {
            throw new TypeError("OrbWallet: `apiKey` is required. " +
                "Pass it via `new OrbWallet({ apiKey: '...' })` or set the " +
                "ORB_API_KEY environment variable.");
        }
        this.http = new http_js_1.HttpClient(options.baseUrl ?? DEFAULT_BASE_URL, options.apiKey);
        // Optional Covenant spend-authorization gate. When configured, it runs a
        // pre-sign authorization call before every send and x402 payment.
        const spendGate = options.covenant
            ? new covenant_js_1.SpendGate(new covenant_js_1.CovenantSpendAuthzClient(options.covenant), this.http)
            : undefined;
        this.covenant = spendGate;
        this.wallet = new wallet_js_1.WalletModule(this.http, spendGate);
        this.x402 = new x402_js_1.X402Module(this.http, spendGate);
    }
}
exports.OrbWallet = OrbWallet;
