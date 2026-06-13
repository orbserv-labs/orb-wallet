import type {
  Chain,
  CovenantSpendAuthzConfig,
  PolicyData,
  Token,
} from "../types.js";
import type { HttpClient } from "./http.js";
import {
  CHAIN_TO_CAIP2,
  assetFor,
  creditsFor,
  creditsFromAtomicUsdc,
  toAtomicString,
} from "./chain-assets.js";
import { OrbCovenantError, OrbSpendDeniedError } from "./errors.js";

/** Request body for `POST /spend/authorize`, per the Covenant spec. */
export interface SpendAuthorizeRequest {
  /** Free-form provider tag, recorded on the audit row. */
  provider: string;
  /** CAIP-2 network the wallet intends to settle on. */
  network: string;
  /** Token contract (EVM) or mint (Solana) the spend is denominated in. */
  asset: string;
  /** Atomic amount as a decimal string. */
  amount: string;
  /** Maximum atomic amount one spend may request, as a decimal string. */
  per_call_cap: string;
  /** USD-pegged budget the spend would consume. */
  credits: number;
  /** Pay-to address, recorded on the audit row for triage. */
  destination?: string;
}

/**
 * Request body for `POST /spend/settle`.
 *
 * The daemon does not reconstruct spend details from `decision_id`; the
 * settlement must resend the full spend facts used during authorization plus
 * the on-chain transaction signature.
 */
export interface SpendSettleRequest {
  /** Decision id returned by the authorize call this settles. */
  decision_id: string;
  /** Provider tag, identical to the authorize request. */
  provider: string;
  /** CAIP-2 network, identical to the authorize request. */
  network: string;
  /** Token contract / mint, identical to the authorize request. */
  asset: string;
  /** Atomic amount as a decimal string, identical to the authorize request. */
  amount: string;
  /** USD-pegged credits, identical to the authorize request. */
  credits: number;
  /** On-chain transaction hash / signature of the settled payment. */
  tx_sig: string;
}

/** Raw response from `POST /spend/authorize`. */
interface SpendAuthorizeResponse {
  kind?: string;
  approved?: boolean;
  decision_id?: string;
  reason?: string;
}

/** Result of an approved authorization. */
export interface SpendAuthorization {
  decisionId: string;
}

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
export class CovenantSpendAuthzClient {
  private readonly gatewayUrl: string;
  private readonly token: string;
  readonly provider: string;
  readonly perCallCap?: string;

  /**
   * Spend facts of approved authorizations, keyed by decision id, retained so
   * a later settlement can resend the full payload. Entries are removed once
   * settled; insertion order doubles as eviction order when the cap is hit.
   */
  private readonly factsByDecision = new Map<string, SpendAuthorizeRequest>();

  constructor(config: CovenantSpendAuthzConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, "");
    this.token = config.token;
    this.provider = config.provider ?? "orbserv";
    this.perCallCap = config.perCallCap;
  }

  /** POST a JSON body to the daemon and return the parsed JSON response. */
  private async post<T extends { error?: string }>(
    path: string,
    payload: unknown
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.gatewayUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new OrbCovenantError(
        `Covenant daemon unreachable at ${this.gatewayUrl}: ${
          (err as Error).message
        }`
      );
    }

    let body: T;
    try {
      body = (await response.json()) as T;
    } catch {
      throw new OrbCovenantError(
        `Covenant returned a non-JSON response (status ${response.status})`,
        response.status
      );
    }

    // Transport / configuration problems come back as { error: "<message>" }.
    if (!response.ok || body.error) {
      throw new OrbCovenantError(
        body.error ?? `Covenant request failed (status ${response.status})`,
        response.status,
        body
      );
    }

    return body;
  }

  /** Spend facts retained for a decision id, if this client authorized it. */
  factsFor(decisionId: string): SpendAuthorizeRequest | undefined {
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
  async authorize(req: SpendAuthorizeRequest): Promise<SpendAuthorization> {
    const body = await this.post<SpendAuthorizeResponse & { error?: string }>(
      "/spend/authorize",
      req
    );

    if (!body.decision_id) {
      throw new OrbCovenantError(
        "Covenant response missing decision_id",
        undefined,
        body
      );
    }

    // A policy deny is approved:false, not an HTTP error.
    if (body.approved !== true) {
      throw new OrbSpendDeniedError(body.decision_id, body.reason);
    }

    if (this.factsByDecision.size >= MAX_CACHED_FACTS) {
      const oldest = this.factsByDecision.keys().next().value;
      if (oldest !== undefined) this.factsByDecision.delete(oldest);
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
  async settleSpend(decisionId: string, txSig: string): Promise<void> {
    const facts = this.factsByDecision.get(decisionId);
    if (!facts) {
      throw new OrbCovenantError(
        `No cached authorization facts for decision ${decisionId}; ` +
          "settlement requires the full spend payload from the authorize call"
      );
    }

    const payload: SpendSettleRequest = {
      decision_id: decisionId,
      provider: facts.provider,
      network: facts.network,
      asset: facts.asset,
      amount: facts.amount,
      credits: facts.credits,
      tx_sig: txSig,
    };

    await this.post<{ error?: string }>("/spend/settle", payload);
    this.factsByDecision.delete(decisionId);
  }
}

/**
 * Wraps a {@link CovenantSpendAuthzClient} with the SDK-side glue both spend
 * paths share: resolving the per-call cap (config override, else the wallet's
 * `maxPerTx` policy) and translating SDK chains/tokens or parsed x402
 * challenges into the daemon's request shape.
 */
export class SpendGate {
  private readonly capCache = new Map<string, string>();

  constructor(
    private readonly client: CovenantSpendAuthzClient,
    private readonly http: HttpClient
  ) {}

  /**
   * Drop the cached per-call cap for a wallet so the next authorization
   * re-reads the policy. Called after a policy update changes `maxPerTx`.
   */
  invalidateCap(walletId: string): void {
    this.capCache.delete(walletId);
  }

  private async perCallCap(walletId: string): Promise<string> {
    if (this.client.perCallCap) return this.client.perCallCap;

    const cached = this.capCache.get(walletId);
    if (cached) return cached;

    let policy: PolicyData;
    try {
      policy = await this.http.get<PolicyData>(`/wallets/${walletId}/policy`);
    } catch {
      throw new OrbCovenantError(
        "Covenant per-call cap is unset and the wallet policy could not be " +
          "read; set covenant.perCallCap or configure the wallet's maxPerTx."
      );
    }
    if (policy?.maxPerTx == null) {
      throw new OrbCovenantError(
        "Covenant per-call cap is unset and the wallet has no maxPerTx " +
          "policy; set covenant.perCallCap."
      );
    }

    const cap = toAtomicString(policy.maxPerTx, "USDC");
    this.capCache.set(walletId, cap);
    return cap;
  }

  /** Authorize a direct transfer described by SDK chain/token/amount. */
  async authorizeTransfer(params: {
    walletId: string;
    chain: Chain;
    token: Token;
    amount: number;
    destination?: string;
  }): Promise<string> {
    const { decisionId } = await this.client.authorize({
      provider: this.client.provider,
      network: CHAIN_TO_CAIP2[params.chain],
      asset: assetFor(params.chain, params.token),
      amount: toAtomicString(params.amount, params.token),
      per_call_cap: await this.perCallCap(params.walletId),
      credits: creditsFor(params.amount, params.token),
      destination: params.destination,
    });
    return decisionId;
  }

  /** Authorize a spend described directly by a parsed x402 challenge. */
  async authorizeChallenge(params: {
    walletId: string;
    network: string;
    asset: string;
    atomicAmount: string;
    destination?: string;
  }): Promise<string> {
    const { decisionId } = await this.client.authorize({
      provider: this.client.provider,
      network: params.network,
      asset: params.asset,
      amount: params.atomicAmount,
      per_call_cap: await this.perCallCap(params.walletId),
      credits: creditsFromAtomicUsdc(params.atomicAmount),
      destination: params.destination,
    });
    return decisionId;
  }

  /**
   * Settle an authorized spend. Throws on failure; use {@link settleSafely}
   * from payment paths where settlement must never affect the tx result.
   */
  async settle(decisionId: string, txSig: string): Promise<void> {
    await this.client.settleSpend(decisionId, txSig);
  }

  /**
   * Settle an authorized spend without ever throwing.
   *
   * Settlement is post-transaction accounting: once the payment broadcast
   * succeeded, a settlement failure must not roll back, throw, or mark the
   * payment failed. Failures are logged with the full spend facts so they can
   * be retried later via {@link settle}.
   */
  async settleSafely(decisionId: string, txSig: string): Promise<void> {
    // Capture facts before settling: a successful settle evicts them, and a
    // failed one needs them for the structured log either way.
    const facts = this.client.factsFor(decisionId);
    try {
      await this.client.settleSpend(decisionId, txSig);
    } catch (err) {
      console.warn("Failed to settle Covenant authorization", {
        decisionId,
        provider: facts?.provider,
        network: facts?.network,
        asset: facts?.asset,
        amount: facts?.amount,
        credits: facts?.credits,
        txHash: txSig,
        error: (err as Error).message,
      });
    }
  }
}
