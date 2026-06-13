"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyModule = void 0;
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
class PolicyModule {
    constructor(http, walletId, spendGate) {
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
    async get() {
        return this.http.get(`/wallets/${this.walletId}/policy`);
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
    async update(options) {
        const data = await this.http.patch(`/wallets/${this.walletId}/policy`, options);
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
    async pause() {
        return this.http.post(`/wallets/${this.walletId}/policy/pause`);
    }
    /**
     * Resume a previously paused policy, re-enabling outgoing transactions.
     *
     * @returns The updated {@link PolicyData} with `status: "active"`.
     */
    async resume() {
        return this.http.post(`/wallets/${this.walletId}/policy/resume`);
    }
}
exports.PolicyModule = PolicyModule;
