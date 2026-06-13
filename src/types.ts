// =============================================================================
// Wallet creation & representation
// =============================================================================

/** Supported chain identifiers. */
export type Chain = "solana" | "base" | "ethereum" | "arbitrum";

/** Token identifiers. */
export type Token = "USDC" | "ETH" | "SOL" | "USDT";

/** Spending-policy configuration attached to a wallet. */
export interface PolicyConfig {
  /** Maximum cumulative USDC spend per 24-hour rolling window. */
  dailyLimit?: number;
  /** Maximum USDC spend allowed in a single transaction. */
  maxPerTx?: number;
  /** Allow-list of service categories or tags (e.g. `"x402"`, `"inference"`). */
  whitelist?: string[];
  /** Trigger an alert when single-tx spend exceeds this threshold (USDC). */
  alertAbove?: number;
}

/** Options passed to `WalletModule.create()`. */
export interface CreateWalletOptions {
  /** Human-readable label for the wallet (used in logs and dashboards). */
  name: string;
  /** Chains to activate addresses on. */
  chains: Chain[];
  /** Optional initial spending policy. */
  policy?: PolicyConfig;
}

// =============================================================================
// Raw API response shapes (what the backend returns)
// =============================================================================

/** Chain-specific address object returned by the API. */
export interface ChainAddress {
  address: string;
  chain: Chain;
}

/** Raw wallet object as returned by the REST API. */
export interface WalletData {
  id: string;
  name: string;
  createdAt: string;
  /** Present when Solana chain is active. */
  solana?: ChainAddress;
  /** Single EVM address shared across Base, Ethereum, Arbitrum. */
  evm?: ChainAddress;
  policy: PolicyConfig;
  status: "active" | "paused" | "suspended";
}

// =============================================================================
// Send / history / balance
// =============================================================================

/** Options for `AgentWallet.send()`. */
export interface SendOptions {
  /** Recipient address (EVM `0x…` or Solana base58). */
  to: string;
  /** Amount in USDC (or the specified token's native units). */
  amount: number;
  /** Token to send. Defaults to `"USDC"`. */
  token?: Token;
  /** Chain to execute the transfer on. */
  chain: Chain;
  /**
   * When `true`, the transfer is routed through a ZK shielded layer
   * to obscure the on-chain trail.
   */
  privacy?: boolean;
  /**
   * Pre-obtained Covenant decision id. When supplied, the SDK skips its own
   * pre-spend authorization call and forwards this id to the API for audit
   * correlation. Most callers should leave this unset and let the configured
   * Covenant gate authorize automatically.
   */
  spendDecisionId?: string;
}

/** Canonical transaction record. */
export interface Transaction {
  id: string;
  walletId: string;
  type: "send" | "receive" | "x402";
  chain: Chain;
  token: Token;
  amount: number;
  to?: string;
  from?: string;
  txHash?: string;
  status: "pending" | "confirmed" | "failed";
  privacy: boolean;
  createdAt: string;
  confirmedAt?: string;
  /** Covenant decision id that authorized this spend, when one was used. */
  spendDecisionId?: string;
}

/** Options for `AgentWallet.history()`. */
export interface HistoryOptions {
  /** Maximum number of records to return (default: 50, max: 200). */
  limit?: number;
  /** Cursor for pagination (opaque string from a previous response). */
  cursor?: string;
  /** Filter to a specific chain. */
  chain?: Chain;
  /** Filter to a specific token. */
  token?: Token;
}

/** Paginated history response. */
export interface HistoryResponse {
  transactions: Transaction[];
  /** Present when there are more pages. */
  nextCursor?: string;
  total: number;
}

/** Per-chain, per-token balance entry. */
export interface BalanceEntry {
  chain: Chain;
  token: Token;
  amount: number;
  /** Amount denominated in USD using current market price. */
  usdValue: number;
}

/** Aggregated balance response. */
export interface BalanceResponse {
  walletId: string;
  balances: BalanceEntry[];
  /** Total USD value across all chains and tokens. */
  totalUsdValue: number;
  updatedAt: string;
}

// =============================================================================
// Policy management
// =============================================================================

/** Full policy resource as stored server-side. */
export interface PolicyData {
  walletId: string;
  dailyLimit: number;
  maxPerTx: number;
  whitelist: string[];
  alertAbove: number;
  status: "active" | "paused";
  updatedAt: string;
}

/** Fields that can be updated via `policy.update()`. */
export type UpdatePolicyOptions = Partial<PolicyConfig>;

// =============================================================================
// x402 auto-pay & discovery
// =============================================================================

/** Options for `X402Module.discover()`. */
export interface X402DiscoverOptions {
  /** Filter services by category (e.g. `"inference"`, `"data"`, `"storage"`). */
  category?: string;
  /** Free-text search query. */
  query?: string;
  /** Maximum number of results (default: 20). */
  limit?: number;
}

/** A single x402-compatible service listing. */
export interface X402Service {
  id: string;
  name: string;
  description: string;
  category: string;
  baseUrl: string;
  /** Supported tokens for payment. */
  tokens: Token[];
  /** Supported chains for payment. */
  chains: Chain[];
  /** Typical price per API call in USDC. */
  pricePerCall?: number;
  tags: string[];
}

/** Discovery response. */
export interface X402DiscoverResponse {
  services: X402Service[];
  total: number;
}

/** Options for `AgentWallet.fetch()` / `X402Module.fetch()`. */
export interface FetchOptions extends RequestInit {
  /**
   * Maximum USDC to pay for this request. Acts as a client-side backstop that
   * mirrors the Covenant per-call cap: if the parsed x402 challenge asks for
   * more, the SDK aborts before authorizing or signing.
   */
  maxAmount?: number;
  /**
   * Preferred chain when the x402 challenge offers several payment options.
   * Defaults to the first accepted option.
   */
  chain?: Chain;
}

/** x402 fetch response wrapping the raw Response. */
export interface X402FetchResult {
  /** The raw fetch Response (body unconsumed). */
  response: Response;
  /** Payment receipt returned in the `X-Payment-Receipt` header, if any. */
  paymentReceipt?: string;
  /** Amount deducted from the wallet for this call (USDC). */
  amountCharged?: number;
  /** Covenant decision id that authorized this payment, when one was used. */
  spendDecisionId?: string;
}

// =============================================================================
// OrbWallet constructor options
// =============================================================================

/**
 * Optional Covenant spend-authorization configuration.
 *
 * When present, the SDK calls the Covenant daemon's `POST /spend/authorize`
 * surface before signing a `send` or an x402 payment. The daemon checks the
 * caller's capability, the per-call cap, and the payer's budget, then approves
 * or denies. Omit this to leave the feature off and rely solely on the
 * server-side orbserv policy guardrails.
 *
 * @see https://github.com/open-covenant/covenant/blob/feat/orbserv-spend-authz/docs/spend-authorization.md
 */
export interface CovenantSpendAuthzConfig {
  /** Daemon gateway base URL, e.g. `http://127.0.0.1:8421`. */
  gatewayUrl: string;
  /** Bearer token minted at `$COVENANT_HOME/peers/operator.token`. */
  token: string;
  /** Provider tag recorded on the audit row. Defaults to `"orbserv"`. */
  provider?: string;
  /**
   * Per-call cap as an atomic decimal string (the bound the caller enforces).
   * When omitted, the SDK falls back to the wallet policy's `maxPerTx`.
   */
  perCallCap?: string;
  /**
   * Automatic settlement retry attempts after a successful broadcast.
   * Defaults to `3` (four total tries including the first).
   */
  settlementRetryAttempts?: number;
  /** Delay in milliseconds between settlement retry attempts. Defaults to `100`. */
  settlementRetryDelayMs?: number;
}

/** Options accepted by the `OrbWallet` constructor. */
export interface OrbWalletOptions {
  /** Secret API key issued from the orbserv dashboard. */
  apiKey: string;
  /**
   * Override the default API base URL.
   * Defaults to `https://api.orbserv.co/v1`.
   */
  baseUrl?: string;
  /**
   * Optional Covenant spend-authorization gate. Omit to disable; when set, a
   * pre-sign authorization call runs before every `send` and x402 payment.
   */
  covenant?: CovenantSpendAuthzConfig;
}
