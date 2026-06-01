import type { HttpClient } from "../utils/http.js";
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
export declare class PolicyModule {
    private readonly http;
    private readonly walletId;
    constructor(http: HttpClient, walletId: string);
    /**
     * Retrieve the current policy for this wallet.
     *
     * @returns The current {@link PolicyData}.
     */
    get(): Promise<PolicyData>;
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
    update(options: UpdatePolicyOptions): Promise<PolicyData>;
    /**
     * Pause the spending policy, effectively blocking all outgoing transactions
     * from this wallet until `resume()` is called.
     *
     * @returns The updated {@link PolicyData} with `status: "paused"`.
     */
    pause(): Promise<PolicyData>;
    /**
     * Resume a previously paused policy, re-enabling outgoing transactions.
     *
     * @returns The updated {@link PolicyData} with `status: "active"`.
     */
    resume(): Promise<PolicyData>;
}
