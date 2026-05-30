import type { OrbWalletOptions } from "./types.js";
import { HttpClient } from "./utils/http.js";
import { WalletModule } from "./modules/wallet.js";
import { X402Module } from "./modules/x402.js";

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
export class OrbWallet {
  /**
   * Wallet lifecycle operations: create, get, list.
   *
   * @see {@link WalletModule}
   */
  readonly wallet: WalletModule;

  /**
   * x402 protocol operations: service discovery and auto-pay fetch.
   *
   * @see {@link X402Module}
   */
  readonly x402: X402Module;

  private readonly http: HttpClient;

  /**
   * @param options.apiKey  - Your orbserv API key (required).
   * @param options.baseUrl - Override the API base URL. Defaults to
   *   `https://api.orbserv.co/v1`.
   *
   * @throws {TypeError} When `apiKey` is missing or empty.
   */
  constructor(options: OrbWalletOptions) {
    if (!options.apiKey) {
      throw new TypeError(
        "OrbWallet: `apiKey` is required. " +
          "Pass it via `new OrbWallet({ apiKey: '...' })` or set the " +
          "ORB_API_KEY environment variable."
      );
    }

    this.http = new HttpClient(
      options.baseUrl ?? DEFAULT_BASE_URL,
      options.apiKey
    );

    this.wallet = new WalletModule(this.http);
    this.x402 = new X402Module(this.http);
  }
}
