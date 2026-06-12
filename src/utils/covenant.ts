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

  constructor(config: CovenantSpendAuthzConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, "");
    this.token = config.token;
    this.provider = config.provider ?? "orbserv";
    this.perCallCap = config.perCallCap;
  }

  /**
   * Ask the daemon to approve a spend.
   *
   * @returns the {@link SpendAuthorization} carrying the `decisionId` on approve.
   * @throws {OrbSpendDeniedError} when the daemon denies the spend.
   * @throws {OrbCovenantError} on transport or configuration failure.
   */
  async authorize(req: SpendAuthorizeRequest): Promise<SpendAuthorization> {
    let response: Response;
    try {
      response = await fetch(`${this.gatewayUrl}/spend/authorize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(req),
      });
    } catch (err) {
      throw new OrbCovenantError(
        `Covenant daemon unreachable at ${this.gatewayUrl}: ${
          (err as Error).message
        }`
      );
    }

    let body: SpendAuthorizeResponse & { error?: string };
    try {
      body = (await response.json()) as SpendAuthorizeResponse & {
        error?: string;
      };
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

    if (!body.decision_id) {
      throw new OrbCovenantError(
        "Covenant response missing decision_id",
        response.status,
        body
      );
    }

    // A policy deny is approved:false, not an HTTP error.
    if (body.approved !== true) {
      throw new OrbSpendDeniedError(body.decision_id, body.reason);
    }

    return { decisionId: body.decision_id };
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
}
