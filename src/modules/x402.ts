import type { HttpClient } from "../utils/http.js";
import type {
  X402DiscoverOptions,
  X402DiscoverResponse,
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

  constructor(http: HttpClient) {
    this.http = http;
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
   * @param init - Optional fetch `RequestInit` options.
   * @returns An {@link X402FetchResult} containing the raw Response and
   *   optional payment receipt information.
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
    init?: RequestInit
  ): Promise<X402FetchResult> {
    // Delegate to the backend proxy endpoint so the server can handle
    // x402 negotiation securely with the wallet's private key.
    const response = await this.http.post<{
      status: number;
      headers: Record<string, string>;
      body: string;
      paymentReceipt?: string;
      amountCharged?: number;
    }>("/x402/fetch", {
      walletId,
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? null,
    });

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
    };
  }
}
