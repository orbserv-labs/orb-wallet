import type { HttpClient } from "../utils/http.js";
import type { SpendGate } from "../utils/covenant.js";
import type { PolicyData, UpdatePolicyOptions } from "../types.js";

/**
 * Manages spending-policy operations for a single wallet.
 *
 * Obtained via `agentWallet.policy`.
 *
 * @example
 * ```typescript
 * await wallet.policy.update({ dailyLimit: 100 })
 * await wallet.policy.pause()
 * await wallet.policy.resume()
 * ```
 */
export class PolicyModule {
  private readonly http: HttpClient;
  private readonly walletId: string;
  private readonly spendGate?: SpendGate;

  constructor(http: HttpClient, walletId: string, spendGate?: SpendGate) {
    this.http = http;
    this.walletId = walletId;
    this.spendGate = spendGate;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Retrieve the current policy for this wallet.
   *
   * @returns The current {@link PolicyData}.
   */
  async get(): Promise<PolicyData> {
    return this.http.get<PolicyData>(
      `/wallets/${this.walletId}/policy`
    );
  }

  /**
   * Update one or more policy fields.
   *
   * @param options - Fields to update. Only the provided fields are changed.
   * @returns The updated {@link PolicyData}.
   *
   * @example
   * ```typescript
   * await wallet.policy.update({ dailyLimit: 100, maxPerTx: 25 })
   * ```
   */
  async update(options: UpdatePolicyOptions): Promise<PolicyData> {
    const data = await this.http.patch<PolicyData>(
      `/wallets/${this.walletId}/policy`,
      options
    );
    // The Covenant gate caches the per-call cap derived from maxPerTx; a
    // policy change must not keep authorizing against the stale bound.
    this.spendGate?.invalidateCap(this.walletId);
    return data;
  }

  /**
   * Pause the spending policy, effectively blocking all outgoing transactions
   * from this wallet until `resume()` is called.
   *
   * @returns The updated {@link PolicyData} with `status: "paused"`.
   */
  async pause(): Promise<PolicyData> {
    return this.http.post<PolicyData>(
      `/wallets/${this.walletId}/policy/pause`
    );
  }

  /**
   * Resume a previously paused policy, re-enabling outgoing transactions.
   *
   * @returns The updated {@link PolicyData} with `status: "active"`.
   */
  async resume(): Promise<PolicyData> {
    return this.http.post<PolicyData>(
      `/wallets/${this.walletId}/policy/resume`
    );
  }
}
