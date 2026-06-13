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
import { logSettlementFailure } from "./covenant-logger.js";

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

/** Request body for `POST /spend/settle`. */
export interface SpendSettleRequest {
  decision_id: string;
  provider: string;
  network: string;
  asset: string;
  amount: string;
  credits: string;
  tx_sig: string;
}

/** Authorization facts preserved for settlement — must match authorize exactly. */
export interface CovenantSettlementContext {
  decisionId: string;
  provider: string;
  network: string;
  asset: string;
  amount: string;
  credits: string;
}

/** Result of an approved authorization, including facts for later settlement. */
export interface SpendAuthorizationResult {
  decisionId: string;
  context: CovenantSettlementContext;
}

/** A broadcast that succeeded but whose Covenant settlement is still pending. */
export interface FailedSettlementRecord {
  decisionId: string;
  txHash: string;
  context: CovenantSettlementContext;
  lastError: string;
  attempts: number;
  failedAt: string;
}

/** Raw response from `POST /spend/authorize`. */
interface SpendAuthorizeResponse {
  kind?: string;
  approved?: boolean;
  decision_id?: string;
  reason?: string;
}

/** Raw response from `POST /spend/settle`. */
interface SpendSettleResponse {
  kind?: string;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Client for the Covenant daemon's spend-authorization and settlement
 * surfaces.
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

  private async covenantFetch<T>(
    path: string,
    body: unknown
  ): Promise<{ response: Response; parsed: T & { error?: string } }> {
    let response: Response;
    try {
      response = await fetch(`${this.gatewayUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new OrbCovenantError(
        `Covenant daemon unreachable at ${this.gatewayUrl}: ${
          (err as Error).message
        }`
      );
    }

    let parsed: T & { error?: string };
    try {
      parsed = (await response.json()) as T & { error?: string };
    } catch {
      throw new OrbCovenantError(
        `Covenant returned a non-JSON response (status ${response.status})`,
        response.status
      );
    }

    if (!response.ok || parsed.error) {
      throw new OrbCovenantError(
        parsed.error ?? `Covenant request failed (status ${response.status})`,
        response.status,
        parsed
      );
    }

    return { response, parsed };
  }

  /**
   * Ask the daemon to approve a spend.
   *
   * @throws {OrbSpendDeniedError} when the daemon denies the spend.
   * @throws {OrbCovenantError} on transport or configuration failure.
   */
  async authorize(req: SpendAuthorizeRequest): Promise<SpendAuthorizationResult> {
    const { parsed: body } = await this.covenantFetch<SpendAuthorizeResponse>(
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

    if (body.approved !== true) {
      throw new OrbSpendDeniedError(body.decision_id, body.reason);
    }

    const credits = String(req.credits);
    return {
      decisionId: body.decision_id,
      context: {
        decisionId: body.decision_id,
        provider: req.provider,
        network: req.network,
        asset: req.asset,
        amount: req.amount,
        credits,
      },
    };
  }

  /**
   * Record a completed on-chain spend against a prior authorization.
   *
   * @throws {OrbCovenantError} on transport or configuration failure.
   */
  async settle(req: SpendSettleRequest): Promise<void> {
    await this.covenantFetch<SpendSettleResponse>("/spend/settle", req);
  }
}

/**
 * Wraps a {@link CovenantSpendAuthzClient} with the SDK-side glue both spend
 * paths share: authorization, settlement-context storage, post-broadcast
 * settlement with retries, and manual retry of failed settlements.
 */
export class SpendGate {
  private readonly capCache = new Map<string, string>();
  private readonly contextStore = new Map<string, CovenantSettlementContext>();
  private readonly failedSettlements = new Map<string, FailedSettlementRecord>();
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly client: CovenantSpendAuthzClient,
    private readonly http: HttpClient,
    config?: CovenantSpendAuthzConfig
  ) {
    this.retryAttempts = config?.settlementRetryAttempts ?? 3;
    this.retryDelayMs = config?.settlementRetryDelayMs ?? 100;
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

  private storeAuthorization(result: SpendAuthorizationResult): void {
    this.contextStore.set(result.decisionId, result.context);
  }

  private buildSettleRequest(
    context: CovenantSettlementContext,
    txHash: string
  ): SpendSettleRequest {
    return {
      decision_id: context.decisionId,
      provider: context.provider,
      network: context.network,
      asset: context.asset,
      amount: context.amount,
      credits: context.credits,
      tx_sig: txHash,
    };
  }

  /** Authorize a direct transfer described by SDK chain/token/amount. */
  async authorizeTransfer(params: {
    walletId: string;
    chain: Chain;
    token: Token;
    amount: number;
    destination?: string;
  }): Promise<SpendAuthorizationResult> {
    const result = await this.client.authorize({
      provider: this.client.provider,
      network: CHAIN_TO_CAIP2[params.chain],
      asset: assetFor(params.chain, params.token),
      amount: toAtomicString(params.amount, params.token),
      per_call_cap: await this.perCallCap(params.walletId),
      credits: creditsFor(params.amount, params.token),
      destination: params.destination,
    });
    this.storeAuthorization(result);
    return result;
  }

  /** Authorize a spend described directly by a parsed x402 challenge. */
  async authorizeChallenge(params: {
    walletId: string;
    network: string;
    asset: string;
    atomicAmount: string;
    destination?: string;
  }): Promise<SpendAuthorizationResult> {
    const result = await this.client.authorize({
      provider: this.client.provider,
      network: params.network,
      asset: params.asset,
      amount: params.atomicAmount,
      per_call_cap: await this.perCallCap(params.walletId),
      credits: creditsFromAtomicUsdc(params.atomicAmount),
      destination: params.destination,
    });
    this.storeAuthorization(result);
    return result;
  }

  /**
   * Settle a prior authorization using the stored authorization facts.
   * Does not reauthorize or rebroadcast.
   */
  async settleSpend(decisionId: string, txHash: string): Promise<void> {
    const context = this.contextStore.get(decisionId);
    if (!context) {
      throw new OrbCovenantError(
        `No settlement context for decision ${decisionId}`
      );
    }
    await this.client.settle(this.buildSettleRequest(context, txHash));
    this.failedSettlements.delete(decisionId);
  }

  /**
   * Post-broadcast settlement with automatic retries. Failures are logged and
   * recorded for manual retry; they never affect the already-successful payment.
   */
  async settleAfterBroadcast(
    decisionId: string,
    txHash: string
  ): Promise<void> {
    const context = this.contextStore.get(decisionId);
    if (!context) return;

    let lastErr: unknown;
    const maxAttempts = this.retryAttempts + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.settleSpend(decisionId, txHash);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          await delay(this.retryDelayMs);
        }
      }
    }

    const record: FailedSettlementRecord = {
      decisionId,
      txHash,
      context,
      lastError: errorMessage(lastErr),
      attempts: maxAttempts,
      failedAt: new Date().toISOString(),
    };
    this.failedSettlements.set(decisionId, record);

    logSettlementFailure({
      ...context,
      txHash,
      error: lastErr,
      attempts: maxAttempts,
    });
  }

  /** List settlements that failed after automatic retries. */
  listFailedSettlements(): FailedSettlementRecord[] {
    return [...this.failedSettlements.values()];
  }

  /**
   * Retry settlement for a specific failed decision. Does not reauthorize or
   * rebroadcast.
   *
   * @returns true when settlement succeeds.
   */
  async retryFailedSettlement(decisionId: string): Promise<boolean> {
    const record = this.failedSettlements.get(decisionId);
    if (!record) return false;
    try {
      await this.settleSpend(decisionId, record.txHash);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retry the most recently recorded failed settlement.
   *
   * @returns true when settlement succeeds.
   */
  async retryLatestFailedSettlement(): Promise<boolean> {
    const records = this.listFailedSettlements();
    if (records.length === 0) return false;
    const latest = records.reduce((a, b) =>
      a.failedAt >= b.failedAt ? a : b
    );
    return this.retryFailedSettlement(latest.decisionId);
  }

  /** Invalidate cached per-call cap after a policy update. */
  invalidateCap(walletId: string): void {
    this.capCache.delete(walletId);
  }
}
