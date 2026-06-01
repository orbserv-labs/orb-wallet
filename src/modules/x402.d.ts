import type { HttpClient } from "../utils/http.js";
import type { X402DiscoverOptions, X402DiscoverResponse, X402FetchResult } from "../types.js";
/**
 * Handles x402-protocol operations: service discovery and auto-pay HTTP fetch.
 *
 * Exposed as `orb.x402` on the top-level client.
 * Also used internally by `AgentWallet.fetch()`.
 */
export declare class X402Module {
    private readonly http;
    constructor(http: HttpClient);
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
    discover(options?: X402DiscoverOptions): Promise<X402DiscoverResponse>;
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
    fetch(walletId: string, url: string, init?: RequestInit): Promise<X402FetchResult>;
}
