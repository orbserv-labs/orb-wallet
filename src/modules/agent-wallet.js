"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentWallet = void 0;
const policy_js_1 = require("./policy.js");
const x402_js_1 = require("./x402.js");
/**
 * Represents a live agent wallet instance.
 *
 * Returned by `orb.wallet.create()`, `orb.wallet.get()`, and `orb.wallet.list()`.
 * Provides direct methods for sending funds, querying history/balance, and
 * managing the wallet's spending policy.
 *
 * @example
 * ```typescript
 * const wallet = await orb.wallet.create({ name: "my-agent", chains: ["solana", "base"] })
 *
 * wallet.solana.address  // Sol address
 * wallet.evm.address     // 0x address
 *
 * await wallet.send({ to: "0xRecipient", amount: 5, token: "USDC", chain: "base" })
 * ```
 */
class AgentWallet {
    constructor(data, http) {
        this.id = data.id;
        this.name = data.name;
        this.createdAt = data.createdAt;
        this.status = data.status;
        // Provide safe defaults so that callers using TypeScript strict mode can
        // rely on these being defined — the API always returns addresses for the
        // chains that were activated at creation time.
        this.solana = data.solana ?? { address: "", chain: "solana" };
        this.evm = data.evm ?? { address: "", chain: "base" };
        this.http = http;
        this.policy = new policy_js_1.PolicyModule(http, data.id);
        this.x402Module = new x402_js_1.X402Module(http);
    }
    // -------------------------------------------------------------------------
    // Funds
    // -------------------------------------------------------------------------
    /**
     * Send tokens from this wallet to another address.
     *
     * @param options - Transfer parameters including recipient, amount, token, chain,
     *   and optional ZK-shielding via `privacy: true`.
     * @returns The resulting {@link Transaction} record.
     *
     * @example
     * ```typescript
     * await wallet.send({
     *   to: "0xRecipient",
     *   amount: 5,
     *   token: "USDC",
     *   chain: "base",
     *   privacy: true
     * })
     * ```
     */
    async send(options) {
        return this.http.post(`/wallets/${this.id}/send`, {
            to: options.to,
            amount: options.amount,
            token: options.token ?? "USDC",
            chain: options.chain,
            privacy: options.privacy ?? false,
        });
    }
    // -------------------------------------------------------------------------
    // History & balance
    // -------------------------------------------------------------------------
    /**
     * Retrieve paginated transaction history for this wallet.
     *
     * @param options - Optional filters and pagination parameters.
     * @returns A {@link HistoryResponse} containing transactions and cursor.
     *
     * @example
     * ```typescript
     * const history = await wallet.history({ limit: 20 })
     * history.transactions.forEach(tx => console.log(tx.txHash))
     * ```
     */
    async history(options = {}) {
        const params = new URLSearchParams();
        if (options.limit !== undefined)
            params.set("limit", String(options.limit));
        if (options.cursor)
            params.set("cursor", options.cursor);
        if (options.chain)
            params.set("chain", options.chain);
        if (options.token)
            params.set("token", options.token);
        const query = params.toString();
        return this.http.get(`/wallets/${this.id}/history${query ? `?${query}` : ""}`);
    }
    /**
     * Get the current token balances for this wallet across all active chains.
     *
     * @returns A {@link BalanceResponse} with per-chain, per-token balances and
     *   a total USD value.
     *
     * @example
     * ```typescript
     * const balance = await wallet.balance()
     * console.log(`Total: $${balance.totalUsdValue}`)
     * ```
     */
    async balance() {
        return this.http.get(`/wallets/${this.id}/balance`);
    }
    // -------------------------------------------------------------------------
    // x402 auto-pay
    // -------------------------------------------------------------------------
    /**
     * Perform an HTTP request with automatic x402 payment handling.
     *
     * If the target URL returns `HTTP 402 Payment Required`, the SDK
     * automatically negotiates and submits a micro-payment from this wallet
     * and retries the request — no manual intervention needed.
     *
     * @param url - The URL to fetch.
     * @param init - Optional fetch `RequestInit` options.
     * @returns An {@link X402FetchResult} with the final Response.
     *
     * @example
     * ```typescript
     * const { response } = await wallet.fetch("https://api.service.com/data")
     * const json = await response.json()
     * ```
     */
    async fetch(url, init) {
        return this.x402Module.fetch(this.id, url, init);
    }
}
exports.AgentWallet = AgentWallet;
