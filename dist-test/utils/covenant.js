"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendGate = exports.CovenantSpendAuthzClient = void 0;
const chain_assets_js_1 = require("./chain-assets.js");
const errors_js_1 = require("./errors.js");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Maximum number of authorization fact entries retained for settlement.
 * Entries are deleted once settled; the cap only matters for spends that are
 * authorized but never settle (denied broadcasts, crashes, abandoned flows).
 */
const MAX_CACHED_FACTS = 200;
/**
 * Client for the Covenant daemon's spend-authorization surface.
 *
 * Calls `POST {gatewayUrl}/spend/authorize` before a wallet signs, so the
 * daemon can check the caller's capability, the per-call cap, and the payer's
 * budget. No funds move; it is a decision, not a payment.
 */
class CovenantSpendAuthzClient {
    constructor(config) {
        /**
         * Spend facts of approved authorizations, keyed by decision id, retained so
         * a later settlement can resend the full payload. Entries are removed once
         * settled; insertion order doubles as eviction order when the cap is hit.
         */
        this.factsByDecision = new Map();
        this.gatewayUrl = config.gatewayUrl.replace(/\/$/, "");
        this.token = config.token;
        this.provider = config.provider ?? "orbserv";
        this.perCallCap = config.perCallCap;
    }
    /** POST a JSON body to the daemon and return the parsed JSON response. */
    async post(path, payload) {
        let response;
        try {
            response = await fetch(`${this.gatewayUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify(payload),
            });
        }
        catch (err) {
            throw new errors_js_1.OrbCovenantError(`Covenant daemon unreachable at ${this.gatewayUrl}: ${err.message}`);
        }
        let body;
        try {
            body = (await response.json());
        }
        catch {
            throw new errors_js_1.OrbCovenantError(`Covenant returned a non-JSON response (status ${response.status})`, response.status);
        }
        // Transport / configuration problems come back as { error: "<message>" }.
        if (!response.ok || body.error) {
            throw new errors_js_1.OrbCovenantError(body.error ?? `Covenant request failed (status ${response.status})`, response.status, body);
        }
        return body;
    }
    /** Spend facts retained for a decision id, if this client authorized it. */
    factsFor(decisionId) {
        return this.factsByDecision.get(decisionId);
    }
    /**
     * Ask the daemon to approve a spend.
     *
     * On approval, the spend facts are cached against the returned decision id
     * so {@link settleSpend} can later resend the full payload.
     *
     * @returns the {@link SpendAuthorization} carrying the `decisionId` on approve.
     * @throws {OrbSpendDeniedError} when the daemon denies the spend.
     * @throws {OrbCovenantError} on transport or configuration failure.
     */
    async authorize(req) {
        const body = await this.post("/spend/authorize", req);
        if (!body.decision_id) {
            throw new errors_js_1.OrbCovenantError("Covenant response missing decision_id", undefined, body);
        }
        // A policy deny is approved:false, not an HTTP error.
        if (body.approved !== true) {
            throw new errors_js_1.OrbSpendDeniedError(body.decision_id, body.reason);
        }
        if (this.factsByDecision.size >= MAX_CACHED_FACTS) {
            const oldest = this.factsByDecision.keys().next().value;
            if (oldest !== undefined)
                this.factsByDecision.delete(oldest);
        }
        this.factsByDecision.set(body.decision_id, req);
        return { decisionId: body.decision_id };
    }
    /**
     * Settle an authorized spend after the transaction landed on-chain.
     *
     * The daemon does not reconstruct facts from the decision id, so this
     * resends the full spend payload cached during {@link authorize} plus the
     * transaction signature. Settlement is post-transaction accounting: callers
     * in the payment path must treat failures as non-fatal.
     *
     * @param decisionId - The decision id returned by the authorize call.
     * @param txSig - On-chain transaction hash / signature.
     * @throws {OrbCovenantError} when the facts are unknown to this client or
     *   the daemon call fails.
     */
    async settleSpend(decisionId, txSig) {
        const facts = this.factsByDecision.get(decisionId);
        if (!facts) {
            throw new errors_js_1.OrbCovenantError(`No cached authorization facts for decision ${decisionId}; ` +
                "settlement requires the full spend payload from the authorize call");
        }
        const payload = {
            decision_id: decisionId,
            provider: facts.provider,
            network: facts.network,
            asset: facts.asset,
            amount: facts.amount,
            credits: facts.credits,
            tx_sig: txSig,
        };
        await this.post("/spend/settle", payload);
        this.factsByDecision.delete(decisionId);
    }
}
exports.CovenantSpendAuthzClient = CovenantSpendAuthzClient;
/**
 * Wraps a {@link CovenantSpendAuthzClient} with the SDK-side glue both spend
 * paths share: resolving the per-call cap (config override, else the wallet's
 * `maxPerTx` policy) and translating SDK chains/tokens or parsed x402
 * challenges into the daemon's request shape.
 */
class SpendGate {
    constructor(client, http) {
        this.client = client;
        this.http = http;
        this.capCache = new Map();
    }
    /**
     * Drop the cached per-call cap for a wallet so the next authorization
     * re-reads the policy. Called after a policy update changes `maxPerTx`.
     */
    invalidateCap(walletId) {
        this.capCache.delete(walletId);
    }
    async perCallCap(walletId) {
        if (this.client.perCallCap)
            return this.client.perCallCap;
        const cached = this.capCache.get(walletId);
        if (cached)
            return cached;
        let policy;
        try {
            policy = await this.http.get(`/wallets/${walletId}/policy`);
        }
        catch {
            throw new errors_js_1.OrbCovenantError("Covenant per-call cap is unset and the wallet policy could not be " +
                "read; set covenant.perCallCap or configure the wallet's maxPerTx.");
        }
        if (policy?.maxPerTx == null) {
            throw new errors_js_1.OrbCovenantError("Covenant per-call cap is unset and the wallet has no maxPerTx " +
                "policy; set covenant.perCallCap.");
        }
        const cap = (0, chain_assets_js_1.toAtomicString)(policy.maxPerTx, "USDC");
        this.capCache.set(walletId, cap);
        return cap;
    }
    /** Authorize a direct transfer described by SDK chain/token/amount. */
    async authorizeTransfer(params) {
        const { decisionId } = await this.client.authorize({
            provider: this.client.provider,
            network: chain_assets_js_1.CHAIN_TO_CAIP2[params.chain],
            asset: (0, chain_assets_js_1.assetFor)(params.chain, params.token),
            amount: (0, chain_assets_js_1.toAtomicString)(params.amount, params.token),
            per_call_cap: await this.perCallCap(params.walletId),
            credits: (0, chain_assets_js_1.creditsFor)(params.amount, params.token),
            destination: params.destination,
        });
        return decisionId;
    }
    /** Authorize a spend described directly by a parsed x402 challenge. */
    async authorizeChallenge(params) {
        const { decisionId } = await this.client.authorize({
            provider: this.client.provider,
            network: params.network,
            asset: params.asset,
            amount: params.atomicAmount,
            per_call_cap: await this.perCallCap(params.walletId),
            credits: (0, chain_assets_js_1.creditsFromAtomicUsdc)(params.atomicAmount),
            destination: params.destination,
        });
        return decisionId;
    }
    /** Spend facts retained for a decision id, if this gate authorized it. */
    factsFor(decisionId) {
        return this.client.factsFor(decisionId);
    }
    /**
     * Settle an authorized spend. Throws on failure; use {@link settleSafely}
     * from payment paths where settlement must never affect the tx result.
     */
    async settle(decisionId, txSig) {
        await this.client.settleSpend(decisionId, txSig);
    }
    /**
     * Retry settlement with bounded backoff after an automatic settle failure.
     *
     * Calls {@link settle} up to `maxAttempts` times (default 3), waiting
     * `delayMs` (default 1000) between failures. Rethrows the last error when
     * all attempts are exhausted.
     */
    async retrySettle(decisionId, txSig, options) {
        const maxAttempts = options?.maxAttempts ?? 3;
        const delayMs = options?.delayMs ?? 1000;
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.settle(decisionId, txSig);
                return;
            }
            catch (err) {
                lastError = err;
                if (attempt < maxAttempts && delayMs > 0) {
                    await delay(delayMs);
                }
            }
        }
        throw lastError;
    }
    /**
     * Settle an authorized spend without ever throwing.
     *
     * Settlement is post-transaction accounting: once the payment broadcast
     * succeeded, a settlement failure must not roll back, throw, or mark the
     * payment failed. Failures are logged with the full spend facts so they can
     * be retried later via {@link settle}.
     */
    async settleSafely(decisionId, txSig) {
        // Capture facts before settling: a successful settle evicts them, and a
        // failed one needs them for the structured log either way.
        const facts = this.client.factsFor(decisionId);
        try {
            await this.client.settleSpend(decisionId, txSig);
        }
        catch (err) {
            console.warn("Failed to settle Covenant authorization", {
                decisionId,
                provider: facts?.provider,
                network: facts?.network,
                asset: facts?.asset,
                amount: facts?.amount,
                credits: facts?.credits,
                txHash: txSig,
                error: err.message,
            });
        }
    }
}
exports.SpendGate = SpendGate;
