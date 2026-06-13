"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const errors_js_1 = require("./errors.js");
/**
 * Lightweight HTTP client that attaches the Bearer token and handles errors.
 * Uses the global `fetch` (Node 18+, browsers). No runtime dependencies.
 */
class HttpClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
        this.apiKey = apiKey;
    }
    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------
    buildUrl(path) {
        return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    }
    headers(extra) {
        return {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...extra,
        };
    }
    async handleResponse(response) {
        let body;
        const contentType = response.headers.get("content-type") ?? "";
        try {
            body = contentType.includes("application/json")
                ? await response.json()
                : await response.text();
        }
        catch {
            body = null;
        }
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new errors_js_1.OrbAuthError(response.status, body);
            }
            throw new errors_js_1.OrbApiError(response.status, body);
        }
        return body;
    }
    // -------------------------------------------------------------------------
    // Public HTTP verbs
    // -------------------------------------------------------------------------
    /**
     * Perform a GET request.
     * @param path - API path relative to baseUrl, e.g. `/wallets/abc`
     */
    async get(path) {
        const response = await fetch(this.buildUrl(path), {
            method: "GET",
            headers: this.headers(),
        });
        return this.handleResponse(response);
    }
    /**
     * Perform a POST request with a JSON body.
     */
    async post(path, body) {
        const response = await fetch(this.buildUrl(path), {
            method: "POST",
            headers: this.headers(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return this.handleResponse(response);
    }
    /**
     * Perform a PATCH request with a JSON body.
     */
    async patch(path, body) {
        const response = await fetch(this.buildUrl(path), {
            method: "PATCH",
            headers: this.headers(),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        return this.handleResponse(response);
    }
    /**
     * Perform a DELETE request.
     */
    async delete(path) {
        const response = await fetch(this.buildUrl(path), {
            method: "DELETE",
            headers: this.headers(),
        });
        return this.handleResponse(response);
    }
    /**
     * Perform an arbitrary fetch, forwarding the Authorization header.
     * Used by `wallet.fetch()` for x402 auto-pay flows.
     */
    async proxyFetch(url, init) {
        const mergedHeaders = {
            ...this.headers(),
            ...init?.headers,
        };
        return fetch(url, { ...init, headers: mergedHeaders });
    }
}
exports.HttpClient = HttpClient;
