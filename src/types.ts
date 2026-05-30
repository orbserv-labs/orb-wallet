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

/** x402 fetch response wrapping the raw Response. */
export interface X402FetchResult {
  /** The raw fetch Response (body unconsumed). */
  response: Response;
  /** Payment receipt returned in the `X-Payment-Receipt` header, if any. */
  paymentReceipt?: string;
  /** Amount deducted from the wallet for this call (USDC). */
  amountCharged?: number;
}

// =============================================================================
// OrbWallet constructor options
// =============================================================================

/** Options accepted by the `OrbWallet` constructor. */
export interface OrbWalletOptions {
  /** Secret API key issued from the orbserv dashboard. */
  apiKey: string;
  /**
   * Override the default API base URL.
   * Defaults to `https://api.orbserv.co/v1`.
   */
  baseUrl?: string;
}
