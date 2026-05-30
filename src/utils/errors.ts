/**
 * Base error class for all orb-wallet SDK errors.
 */
export class OrbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrbError";
    // Maintain proper prototype chain in transpiled ES5+
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns a non-2xx response.
 * Contains the HTTP status code and the raw response body.
 */
export class OrbApiError extends OrbError {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, body: unknown) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as Record<string, unknown>).message)
        : `API error ${statusCode}`;
    super(message);
    this.name = "OrbApiError";
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the request fails due to authentication issues (401 / 403).
 */
export class OrbAuthError extends OrbApiError {
  constructor(statusCode: number, body: unknown) {
    super(statusCode, body);
    this.name = "OrbAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
