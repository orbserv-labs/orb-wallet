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
export {
  OrbError,
  OrbApiError,
  OrbAuthError,
  OrbSpendDeniedError,
  OrbCovenantError,
} from "./utils/errors.js";

// HTTP client (exposed for advanced use, e.g. testing)
export { HttpClient } from "./utils/http.js";

// Covenant spend-authorization (exposed for advanced use / direct authorize)
export { CovenantSpendAuthzClient, SpendGate } from "./utils/covenant.js";
export type {
  SpendAuthorizeRequest,
  SpendAuthorizationResult,
  SpendSettleRequest,
  CovenantSettlementContext,
  FailedSettlementRecord,
} from "./utils/covenant.js";

export {
  setCovenantSettlementLogger,
  resetCovenantSettlementLogger,
  logSettlementFailure,
} from "./utils/covenant-logger.js";
export type { CovenantSettlementFailureLog } from "./utils/covenant-logger.js";

// All public types
export type {
  // Enums
  Chain,
  Token,
  // Wallet
  OrbWalletOptions,
  CovenantSpendAuthzConfig,
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
  FetchOptions,
  X402FetchResult,
} from "./types.js";
