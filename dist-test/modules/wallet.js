"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletModule = void 0;
const agent_wallet_js_1 = require("./agent-wallet.js");
/**
 * Manages wallet lifecycle operations: create, retrieve, and list wallets.
 *
 * Exposed as `orb.wallet` on the top-level {@link OrbWallet} client.
 *
 * @example
 * ```typescript
 * const wallet = await orb.wallet.create({
 *   name: "my-agent",
 *   chains: ["solana", "base", "ethereum", "arbitrum"],
 *   policy: { dailyLimit: 50, maxPerTx: 10 }
 * })
 * ```
 */
class WalletModule {
    constructor(http, spendGate) {
        this.http = http;
        this.spendGate = spendGate;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Create a new agent wallet.
     *
     * @param options - Wallet creation parameters: name, chains, and optional policy.
     * @returns A fully initialised {@link AgentWallet} instance.
     *
     * @example
     * ```typescript
     * const wallet = await orb.wallet.create({
     *   name: "my-agent",
     *   chains: ["solana", "base", "ethereum", "arbitrum"],
     *   policy: {
     *     dailyLimit: 50,
     *     maxPerTx: 10,
     *     whitelist: ["x402", "inference"],
     *     alertAbove: 20
     *   }
     * })
     *
     * console.log(wallet.solana.address)  // Sol address
     * console.log(wallet.evm.address)     // 0x address
     * ```
     */
    async create(options) {
        const data = await this.http.post("/wallets", options);
        return new agent_wallet_js_1.AgentWallet(data, this.http, this.spendGate);
    }
    /**
     * Retrieve an existing wallet by its ID.
     *
     * @param id - The wallet ID (e.g. `"wal_abc123"`).
     * @returns The {@link AgentWallet} instance.
     *
     * @example
     * ```typescript
     * const wallet = await orb.wallet.get("wal_abc123")
     * ```
     */
    async get(id) {
        const data = await this.http.get(`/wallets/${id}`);
        return new agent_wallet_js_1.AgentWallet(data, this.http, this.spendGate);
    }
    /**
     * List all wallets associated with the current API key.
     *
     * @returns An array of {@link AgentWallet} instances.
     *
     * @example
     * ```typescript
     * const wallets = await orb.wallet.list()
     * wallets.forEach(w => console.log(w.id, w.name))
     * ```
     */
    async list() {
        const data = await this.http.get("/wallets");
        return data.map((d) => new agent_wallet_js_1.AgentWallet(d, this.http, this.spendGate));
    }
}
exports.WalletModule = WalletModule;
