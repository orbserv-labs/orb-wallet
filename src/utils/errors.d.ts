/**
 * Base error class for all orb-wallet SDK errors.
 */
export declare class OrbError extends Error {
    constructor(message: string);
}
/**
 * Thrown when the API returns a non-2xx response.
 * Contains the HTTP status code and the raw response body.
 */
export declare class OrbApiError extends OrbError {
    readonly statusCode: number;
    readonly body: unknown;
    constructor(statusCode: number, body: unknown);
}
/**
 * Thrown when the request fails due to authentication issues (401 / 403).
 */
export declare class OrbAuthError extends OrbApiError {
    constructor(statusCode: number, body: unknown);
}
