import type { HttpClient } from "../utils/http.js";
import type { CreateWalletOptions, WalletData } from "../types.js";
import { AgentWallet } from "./agent-wallet.js";

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
export class WalletModule {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
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
  async create(options: CreateWalletOptions): Promise<AgentWallet> {
    const data = await this.http.post<WalletData>("/wallets", options);
    return new AgentWallet(data, this.http);
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
  async get(id: string): Promise<AgentWallet> {
    const data = await this.http.get<WalletData>(`/wallets/${id}`);
    return new AgentWallet(data, this.http);
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
  async list(): Promise<AgentWallet[]> {
    const data = await this.http.get<WalletData[]>("/wallets");
    return data.map((d) => new AgentWallet(d, this.http));
  }
}
