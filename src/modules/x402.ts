import type { HttpClient } from "../utils/http.js";
import type { SpendGate } from "../utils/covenant.js";
import { parseX402Challenge, txSigFromReceipt } from "../utils/x402-challenge.js";
import { OrbCovenantError } from "../utils/errors.js";
import { toAtomicString } from "../utils/chain-assets.js";
import type {
  X402DiscoverOptions,
  X402DiscoverResponse,
  FetchOptions,
  X402FetchResult,
} from "../types.js";

/**
 * Handles x402-protocol operations: service discovery and auto-pay HTTP fetch.
 *
 * Exposed as `orb.x402` on the top-level client.
 * Also used internally by `AgentWallet.fetch()`.
 */
export class X402Module {
  private readonly http: HttpClient;
  private readonly spendGate?: SpendGate;

  constructor(http: HttpClient, spendGate?: SpendGate) {
    this.http = http;
    this.spendGate = spendGate;
  }

  // -------------------------------------------------------------------------
  // Top-level discovery (orb.x402.discover)
  // -------------------------------------------------------------------------

  /**
   * Discover x402-compatible services registered in the orbserv marketplace.
   *
   * @param options - Optional filters: category, free-text query, limit.
   * @returns A list of {@link X402Service} entries and a total count.
   *
   * @example
   * ```typescript
   * const services = await orb.x402.discover({ category: "inference" })
   * console.log(services.services[0].baseUrl)
   * ```
   */
  async discover(options: X402DiscoverOptions = {}): Promise<X402DiscoverResponse> {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.query) params.set("query", options.query);
    if (options.limit !== undefined) params.set("limit", String(options.limit));

    const query = params.toString();
    return this.http.get<X402DiscoverResponse>(
      `/x402/services${query ? `?${query}` : ""}`
    );
  }

  // -------------------------------------------------------------------------
  // Auto-pay fetch (used by AgentWallet.fetch)
  // -------------------------------------------------------------------------

  /**
   * Perform an HTTP request, automatically handling x402 payment challenges.
   *
   * When the target URL returns `HTTP 402`, the SDK negotiates payment using
   * the wallet associated with this SDK instance and retries the request.
   *
   * @param walletId - The wallet to charge for the request.
   * @param url - The target URL.
   * @param init - Optional fetch options, including `maxAmount` and `chain`.
   * @returns An {@link X402FetchResult} containing the raw Response and
   *   optional payment receipt information.
   *
   * @remarks
   * When a Covenant spend gate is configured, the SDK first probes the URL
   * client-side. If the target answers `402`, it parses the challenge and asks
   * the Covenant daemon to authorize the spend before delegating the signed
   * payment to the backend. A deny throws {@link OrbSpendDeniedError}.
   *
   * @example
   * ```typescript
   * const result = await wallet.fetch("https://api.service.com/data")
   * const json = await result.response.json()
   * ```
   */
  async fetch(
    walletId: string,
    url: string,
    init?: FetchOptions
  ): Promise<X402FetchResult> {
    let decisionId: string | undefined;

    // With a Covenant gate, preflight the spend client-side: probe the URL,
    // and only authorize + pay when the target actually demands payment.
    if (this.spendGate) {
      const probe = await fetch(url, {
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body ?? null,
      });

      // No payment required — return the probe response untouched.
      if (probe.status !== 402) {
        return { response: probe };
      }

      const challenge = await parseX402Challenge(probe, init?.chain);
      if (!challenge) {
        throw new OrbCovenantError(
          `Received 402 from ${url} but could not parse an x402 payment challenge`
        );
      }

      // Client-side backstop mirroring the Covenant per-call cap.
      if (init?.maxAmount !== undefined) {
        const maxAtomic = toAtomicString(init.maxAmount, "USDC");
        if (BigInt(challenge.amount) > BigInt(maxAtomic)) {
          throw new OrbCovenantError(
            `x402 challenge amount ${challenge.amount} exceeds maxAmount ${maxAtomic}`
          );
        }
      }

      decisionId = await this.spendGate.authorizeChallenge({
        walletId,
        network: challenge.network,
        asset: challenge.asset,
        atomicAmount: challenge.amount,
        destination: challenge.destination,
      });
    }

    // Delegate to the backend proxy endpoint so the server can handle
    // x402 negotiation securely with the wallet's private key.
    const response = await this.http.post<{
      status: number;
      headers: Record<string, string>;
      body: string;
      paymentReceipt?: string;
      amountCharged?: number;
      spendDecisionId?: string;
    }>("/x402/fetch", {
      walletId,
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? null,
      ...(decisionId ? { spendAuthorization: { decisionId } } : {}),
    });

    // The payment already happened server-side; settlement is accounting and
    // must never affect the result returned to the caller.
    if (decisionId && this.spendGate) {
      if (response.paymentReceipt) {
        await this.spendGate.settleSafely(
          decisionId,
          txSigFromReceipt(response.paymentReceipt)
        );
      } else if (response.amountCharged !== undefined) {
        console.warn(
          "Covenant settlement skipped: x402 payment has no receipt",
          { decisionId, walletId, url, amountCharged: response.amountCharged }
        );
      }
    }

    // Re-construct a Response from the proxied result so callers get a
    // familiar interface.
    const proxiedResponse = new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });

    return {
      response: proxiedResponse,
      paymentReceipt: response.paymentReceipt,
      amountCharged: response.amountCharged,
      spendDecisionId: response.spendDecisionId ?? decisionId,
    };
  }
}
