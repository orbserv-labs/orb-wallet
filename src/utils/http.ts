import { OrbApiError, OrbAuthError } from "./errors.js";

/**
 * Lightweight HTTP client that attaches the Bearer token and handles errors.
 * Uses the global `fetch` (Node 18+, browsers). No runtime dependencies.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    let body: unknown;
    const contentType = response.headers.get("content-type") ?? "";

    try {
      body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      body = null;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new OrbAuthError(response.status, body);
      }
      throw new OrbApiError(response.status, body);
    }

    return body as T;
  }

  // -------------------------------------------------------------------------
  // Public HTTP verbs
  // -------------------------------------------------------------------------

  /**
   * Perform a GET request.
   * @param path - API path relative to baseUrl, e.g. `/wallets/abc`
   */
  async get<T>(path: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: "GET",
      headers: this.headers(),
    });
    return this.handleResponse<T>(response);
  }

  /**
   * Perform a POST request with a JSON body.
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  /**
   * Perform a PATCH request with a JSON body.
   */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: "PATCH",
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  /**
   * Perform a DELETE request.
   */
  async delete<T>(path: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: "DELETE",
      headers: this.headers(),
    });
    return this.handleResponse<T>(response);
  }

  /**
   * Perform an arbitrary fetch, forwarding the Authorization header.
   * Used by `wallet.fetch()` for x402 auto-pay flows.
   */
  async proxyFetch(url: string, init?: RequestInit): Promise<Response> {
    const mergedHeaders: Record<string, string> = {
      ...this.headers(),
      ...(init?.headers as Record<string, string> | undefined),
    };
    return fetch(url, { ...init, headers: mergedHeaders });
  }
}
