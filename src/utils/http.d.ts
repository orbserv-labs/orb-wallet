/**
 * Lightweight HTTP client that attaches the Bearer token and handles errors.
 * Uses the global `fetch` (Node 18+, browsers). No runtime dependencies.
 */
export declare class HttpClient {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(baseUrl: string, apiKey: string);
    private buildUrl;
    private headers;
    private handleResponse;
    /**
     * Perform a GET request.
     * @param path - API path relative to baseUrl, e.g. `/wallets/abc`
     */
    get<T>(path: string): Promise<T>;
    /**
     * Perform a POST request with a JSON body.
     */
    post<T>(path: string, body?: unknown): Promise<T>;
    /**
     * Perform a PATCH request with a JSON body.
     */
    patch<T>(path: string, body?: unknown): Promise<T>;
    /**
     * Perform a DELETE request.
     */
    delete<T>(path: string): Promise<T>;
    /**
     * Perform an arbitrary fetch, forwarding the Authorization header.
     * Used by `wallet.fetch()` for x402 auto-pay flows.
     */
    proxyFetch(url: string, init?: RequestInit): Promise<Response>;
}
