"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbCovenantError = exports.OrbSpendDeniedError = exports.OrbAuthError = exports.OrbApiError = exports.OrbError = void 0;
/**
 * Base error class for all orb-wallet SDK errors.
 */
class OrbError extends Error {
    constructor(message) {
        super(message);
        this.name = "OrbError";
        // Maintain proper prototype chain in transpiled ES5+
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.OrbError = OrbError;
/**
 * Thrown when the API returns a non-2xx response.
 * Contains the HTTP status code and the raw response body.
 */
class OrbApiError extends OrbError {
    constructor(statusCode, body) {
        const message = typeof body === "object" && body !== null && "message" in body
            ? String(body.message)
            : `API error ${statusCode}`;
        super(message);
        this.name = "OrbApiError";
        this.statusCode = statusCode;
        this.body = body;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.OrbApiError = OrbApiError;
/**
 * Thrown when the request fails due to authentication issues (401 / 403).
 */
class OrbAuthError extends OrbApiError {
    constructor(statusCode, body) {
        super(statusCode, body);
        this.name = "OrbAuthError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.OrbAuthError = OrbAuthError;
/**
 * Thrown when the Covenant daemon denies a spend.
 *
 * This is a policy verdict (`approved: false`), not a transport failure.
 * The {@link decisionId} can still be correlated to the audit chain, and
 * {@link reason} is operator-readable and safe to surface to the user.
 */
class OrbSpendDeniedError extends OrbError {
    constructor(decisionId, reason) {
        super(reason ?? "Spend denied by Covenant policy");
        this.name = "OrbSpendDeniedError";
        this.decisionId = decisionId;
        this.reason = reason;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.OrbSpendDeniedError = OrbSpendDeniedError;
/**
 * Thrown when the Covenant spend-authorization call cannot complete for a
 * transport or configuration reason (daemon unreachable, surface not
 * enabled, missing capability, malformed response). Distinct from a policy
 * deny, which is an {@link OrbSpendDeniedError}.
 */
class OrbCovenantError extends OrbError {
    constructor(message, statusCode, body) {
        super(message);
        this.name = "OrbCovenantError";
        this.statusCode = statusCode;
        this.body = body;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.OrbCovenantError = OrbCovenantError;
