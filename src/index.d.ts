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
export { OrbWallet } from "./client.js";
export { WalletModule } from "./modules/wallet.js";
export { AgentWallet } from "./modules/agent-wallet.js";
export { PolicyModule } from "./modules/policy.js";
export { X402Module } from "./modules/x402.js";
export { OrbError, OrbApiError, OrbAuthError } from "./utils/errors.js";
export { HttpClient } from "./utils/http.js";
export type { Chain, Token, OrbWalletOptions, CreateWalletOptions, WalletData, ChainAddress, PolicyConfig, SendOptions, Transaction, HistoryOptions, HistoryResponse, BalanceEntry, BalanceResponse, PolicyData, UpdatePolicyOptions, X402DiscoverOptions, X402DiscoverResponse, X402Service, X402FetchResult, } from "./types.js";
