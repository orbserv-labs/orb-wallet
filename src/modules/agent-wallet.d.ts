import type { HttpClient } from "../utils/http.js";
import type { WalletData, ChainAddress, SendOptions, Transaction, HistoryOptions, HistoryResponse, BalanceResponse, X402FetchResult } from "../types.js";
import { PolicyModule } from "./policy.js";
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
export declare class AgentWallet {
    /** Unique wallet identifier. */
    readonly id: string;
    /** Human-readable wallet name. */
    readonly name: string;
    /**
     * Solana address details.
     * Present only when the wallet was created with `chains: ["solana", ...]`.
     */
    readonly solana: ChainAddress;
    /**
     * EVM address details (shared across Base, Ethereum, Arbitrum).
     * Present only when at least one EVM chain was included at creation.
     */
    readonly evm: ChainAddress;
    /** ISO 8601 timestamp of wallet creation. */
    readonly createdAt: string;
    /** Current wallet status. */
    readonly status: WalletData["status"];
    /**
     * Spending policy manager for this wallet.
     *
     * @example
     * ```typescript
     * await wallet.policy.update({ dailyLimit: 100 })
     * await wallet.policy.pause()
     * await wallet.policy.resume()
     * ```
     */
    readonly policy: PolicyModule;
    private readonly http;
    private readonly x402Module;
    constructor(data: WalletData, http: HttpClient);
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
    send(options: SendOptions): Promise<Transaction>;
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
    history(options?: HistoryOptions): Promise<HistoryResponse>;
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
    balance(): Promise<BalanceResponse>;
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
    fetch(url: string, init?: RequestInit): Promise<X402FetchResult>;
}
