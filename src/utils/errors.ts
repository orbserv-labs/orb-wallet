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

/**
 * Thrown when the Covenant daemon denies a spend.
 *
 * This is a policy verdict (`approved: false`), not a transport failure.
 * The {@link decisionId} can still be correlated to the audit chain, and
 * {@link reason} is operator-readable and safe to surface to the user.
 */
export class OrbSpendDeniedError extends OrbError {
  readonly decisionId: string;
  readonly reason?: string;

  constructor(decisionId: string, reason?: string) {
    super(reason ?? "Spend denied by Covenant policy");
    this.name = "OrbSpendDeniedError";
    this.decisionId = decisionId;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the Covenant spend-authorization call cannot complete for a
 * transport or configuration reason (daemon unreachable, surface not
 * enabled, missing capability, malformed response). Distinct from a policy
 * deny, which is an {@link OrbSpendDeniedError}.
 */
export class OrbCovenantError extends OrbError {
  readonly statusCode?: number;
  readonly body: unknown;

  constructor(message: string, statusCode?: number, body?: unknown) {
    super(message);
    this.name = "OrbCovenantError";
    this.statusCode = statusCode;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
