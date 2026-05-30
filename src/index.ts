/**
 * @orbserv-labs/orb-wallet
 *
 * TypeScript SDK for the orbserv agent wallet API.
 *
 * @example
 * ```typescript
 * import { OrbWallet } from '@orbserv-labs/orb-wallet'
 *
 * const orb = new OrbWallet({ apiKey: process.env.ORB_API_KEY! })
 * const wallet = await orb.wallet.create({ name: "my-agent", chains: ["solana", "base"] })
 * ```
 *
 * @module
 */

// Main client
export { OrbWallet } from "./client.js";

// Modules (useful for typing constructor params / DI)
export { WalletModule } from "./modules/wallet.js";
export { AgentWallet } from "./modules/agent-wallet.js";
export { PolicyModule } from "./modules/policy.js";
export { X402Module } from "./modules/x402.js";

// Error classes
export { OrbError, OrbApiError, OrbAuthError } from "./utils/errors.js";

// HTTP client (exposed for advanced use, e.g. testing)
export { HttpClient } from "./utils/http.js";

// All public types
export type {
  // Enums
  Chain,
  Token,
  // Wallet
  OrbWalletOptions,
  CreateWalletOptions,
  WalletData,
  ChainAddress,
  PolicyConfig,
  // Send
  SendOptions,
  Transaction,
  // History
  HistoryOptions,
  HistoryResponse,
  // Balance
  BalanceEntry,
  BalanceResponse,
  // Policy
  PolicyData,
  UpdatePolicyOptions,
  // x402
  X402DiscoverOptions,
  X402DiscoverResponse,
  X402Service,
  X402FetchResult,
} from "./types.js";
