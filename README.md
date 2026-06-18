# @orbserv-labs/orb-wallet

[![npm version](https://img.shields.io/npm/v/@orbserv-labs/orb-wallet.svg)](https://www.npmjs.com/package/@orbserv-labs/orb-wallet)
[![npm downloads](https://img.shields.io/npm/dm/@orbserv-labs/orb-wallet.svg)](https://www.npmjs.com/package/@orbserv-labs/orb-wallet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

TypeScript SDK for the orbserv agent wallet API. Give your AI agents a multi-chain crypto wallet with built-in spending policies and x402 auto-pay in minutes.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Policy Management](#policy-management)
- [x402 Service Discovery](#x402-service-discovery)
- [Covenant Spend Authorization](#covenant-spend-authorization-optional)
- [Wallet Management](#wallet-management)
- [Error Handling](#error-handling)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [MCP Server — Use with Claude](#mcp-server--use-with-claude)
- [Custody Model](#custody-model)
- [License](#license)

---

## Installation

```bash
npm install @orbserv-labs/orb-wallet
# or
pnpm add @orbserv-labs/orb-wallet
# or
yarn add @orbserv-labs/orb-wallet
```

**Requirements:** Node.js >= 18 (uses native `fetch`). No runtime dependencies.

---

## Quick Start

```typescript
import { OrbWallet } from '@orbserv-labs/orb-wallet'

const orb = new OrbWallet({ apiKey: process.env.ORB_API_KEY! })

// Create a wallet
const wallet = await orb.wallet.create({
  name: "my-agent",
  chains: ["solana", "base", "ethereum", "arbitrum"],
  policy: {
    dailyLimit: 50,      // USDC per day
    maxPerTx: 10,        // USDC per transaction
    whitelist: ["x402", "inference"],
    alertAbove: 20       // alert when a single tx exceeds this
  }
})

console.log(wallet.solana.address)  // Sol address
console.log(wallet.evm.address)     // 0x EVM address (Base / ETH / Arbitrum)

// Send tokens
await wallet.send({
  to: "0xRecipient",
  amount: 5,
  token: "USDC",
  chain: "base",
  privacy: true   // ZK shielded transfer
})

// Transaction history
const history = await wallet.history({ limit: 20 })
history.transactions.forEach(tx => console.log(tx.txHash, tx.amount))

// Balance across all chains
const balance = await wallet.balance()
console.log(`Total: $${balance.totalUsdValue}`)

// x402 auto-pay fetch — handles 402 Payment Required automatically
const { response } = await wallet.fetch("https://api.service.com/data")
const data = await response.json()
```

---

## Policy Management

```typescript
// Update spending limits
await wallet.policy.update({ dailyLimit: 100, maxPerTx: 25 })

// Pause all outgoing transactions
await wallet.policy.pause()

// Re-enable transactions
await wallet.policy.resume()

// Read current policy
const policy = await wallet.policy.get()
console.log(policy.dailyLimit, policy.status)
```

---

## x402 Service Discovery

```typescript
// Discover x402-compatible services on the orbserv marketplace
const services = await orb.x402.discover({ category: "inference" })
services.services.forEach(s => console.log(s.name, s.baseUrl))
```

---

## Covenant Spend Authorization (optional)

Beside the server-side spending policy, the SDK can ask a [Covenant](https://github.com/open-covenant/covenant/blob/feat/orbserv-spend-authz/docs/spend-authorization.md) daemon to authorize each spend *before* it is signed. The daemon checks the caller's capability, a per-call cap, and the payer's budget, records the verdict in its audit chain, and returns approve or deny with a `decision_id`. No funds move — it is a decision, not a payment. The `decision_id` is forwarded to the orbserv API so a later settlement can be correlated back to the authorization.

This is fully optional. Omit the `covenant` config and the SDK behaves exactly as before, relying only on the server-side policy guardrails.

### Enable the Daemon

The Covenant operator opts in at boot:

```bash
# In the daemon environment
export COVENANT_SPEND_AUTHZ_ENABLED=1

# Grant the calling identity the capability
covenant capabilities grant wallet.spend.authorize
```

Smoke-test the contract before pointing the SDK at it:

```bash
curl -sS -X POST http://localhost:<COVENANT_PORT>/spend/authorize \
  -H "Authorization: Bearer $COVENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "orbserv",
    "network": "eip155:8453",
    "asset": "0xYOUR_TOKEN_CONTRACT_ADDRESS",
    "amount": "80000",
    "per_call_cap": "100000",
    "credits": 8,
    "destination": "0xPayee"
  }'
```

### Configure the SDK

```typescript
const orb = new OrbWallet({
  apiKey: process.env.ORB_API_KEY!,
  covenant: {
    gatewayUrl: "http://localhost:<COVENANT_PORT>",   // daemon base URL
    token: process.env.COVENANT_TOKEN!,    // daemon bearer token
    // perCallCap is an atomic decimal string; when omitted, the wallet
    // policy's maxPerTx is used as the per-call cap instead.
    perCallCap: "100000",
    // Settlement retry config — defaults shown below
    settlementRetryAttempts: 3,            // retries after first failure
    settlementRetryDelayMs: 100,           // ms between retries
  },
})
```

With the gate enabled:

- `wallet.send(...)` authorizes the transfer before submitting it.
- `wallet.fetch(url)` probes the URL, and on a `402` it parses the x402 challenge, authorizes, then pays. Non-paid requests are returned untouched.

```typescript
import { OrbSpendDeniedError } from "@orbserv-labs/orb-wallet"

try {
  const tx = await wallet.send({ to: "0xPayee", amount: 0.08, token: "USDC", chain: "base" })
  console.log("authorized + sent", tx.spendDecisionId, tx.txHash)
} catch (err) {
  if (err instanceof OrbSpendDeniedError) {
    // Policy deny — abort and surface the reason to the user.
    console.error("spend denied:", err.reason, "decision:", err.decisionId)
  } else {
    throw err
  }
}
```

> **Tip:** Set the wallet's own `policy.maxPerTx` to mirror `perCallCap` as a hard backstop, so a spend can never exceed the bound even if a call skips the pre-flight.

### Pre-obtained Decision ID

If your application already holds a Covenant decision id (e.g. obtained out-of-band), you can pass it directly to skip the SDK's own pre-flight authorization call:

```typescript
const tx = await wallet.send({
  to: "0xPayee",
  amount: 0.08,
  token: "USDC",
  chain: "base",
  spendDecisionId: "dec_external_abc",  // skips daemon call, forwarded to API
})
```

### Failed Settlement Recovery

After a successful broadcast the SDK automatically tries to settle the Covenant authorization. If all retries fail (daemon downtime, network blip), the SDK logs the failure and stores the record internally — the payment result is unaffected.

```typescript
// List authorizations that broadcast succeeded but settlement failed
const failures = orb.covenant.listFailedSettlements()
// [{ decisionId, txHash, context, lastError, attempts, failedAt }, ...]

// Retry a specific failed settlement by decisionId (no rebroadcast, no reauthorize)
const ok = await orb.covenant.retryFailedSettlement("dec_ok_1")
console.log(ok) // true on success

// Retry the most recently failed settlement
const ok = await orb.covenant.retryLatestFailedSettlement()
console.log(ok) // true on success
```

### Custom Settlement Logger

By default, settlement failures are written to `console.warn`. Override this to integrate with your own logging pipeline:

```typescript
import {
  setCovenantSettlementLogger,
  resetCovenantSettlementLogger,
} from "@orbserv-labs/orb-wallet"

setCovenantSettlementLogger((log) => {
  // log is a CovenantSettlementFailureLog:
  // { decisionId, provider, network, asset, amount, credits, txHash, error, attempts }
  myLogger.error("covenant settlement failed", log)
})

// Restore the default console.warn logger
resetCovenantSettlementLogger()
```

### Local Test Checklist

1. Start the daemon with `COVENANT_SPEND_AUTHZ_ENABLED=1`.
2. Grant the capability: `covenant capabilities grant wallet.spend.authorize`.
3. Verify the contract with the curl example above.
4. Point the SDK at the daemon via the `covenant` config.
5. Run a send within the cap (approve) and one above it (deny).
6. Inspect the audit chain: `covenant audit recent` shows `spend_authorization_decided` rows.

---

## Wallet Management

```typescript
// Retrieve an existing wallet by ID
const wallet = await orb.wallet.get("wal_abc123")

// List all wallets for this API key
const wallets = await orb.wallet.list()
```

---

## Error Handling

```typescript
import {
  OrbApiError,
  OrbAuthError,
  OrbSpendDeniedError,
  OrbCovenantError,
} from '@orbserv-labs/orb-wallet'

try {
  const wallet = await orb.wallet.create({ name: "agent", chains: ["base"] })
} catch (err) {
  if (err instanceof OrbAuthError) {
    // 401 or 403 — check your API key
    console.error("Auth failed:", err.statusCode, err.body)
  } else if (err instanceof OrbApiError) {
    // Any other non-2xx response from the orbserv API
    console.error("API error:", err.statusCode, err.body)
  } else {
    throw err
  }
}

try {
  await wallet.send({ to: "0xPayee", amount: 5, token: "USDC", chain: "base" })
} catch (err) {
  if (err instanceof OrbSpendDeniedError) {
    // Covenant daemon returned approved: false — policy verdict, not a crash.
    // err.decisionId is still valid for audit-chain correlation.
    console.error("spend denied:", err.reason, "decision:", err.decisionId)
  } else if (err instanceof OrbCovenantError) {
    // Transport or configuration failure: daemon unreachable, surface not enabled,
    // missing capability, or malformed response. Distinct from a policy deny.
    console.error("covenant error:", err.message, err.statusCode)
  } else {
    throw err
  }
}
```

| Class | Extends | When thrown |
|---|---|---|
| `OrbError` | `Error` | Base class for all SDK errors |
| `OrbApiError` | `OrbError` | Non-2xx response from the orbserv API |
| `OrbAuthError` | `OrbApiError` | 401 or 403 from the orbserv API |
| `OrbSpendDeniedError` | `OrbError` | Covenant daemon returned `approved: false` |
| `OrbCovenantError` | `OrbError` | Daemon unreachable, misconfigured, or returned malformed response |

---

## API Reference

### `new OrbWallet(options)`

| Option | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | Yes | Your orbserv API key |
| `baseUrl` | `string` | No | Override base URL (default: `https://api.orbserv.co/v1`) |
| `covenant` | `CovenantSpendAuthzConfig` | No | Enable the Covenant spend-authorization gate (see below) |

### `CovenantSpendAuthzConfig`

| Field | Type | Required | Description |
|---|---|---|---|
| `gatewayUrl` | `string` | Yes | Daemon base URL, e.g. `http://127.0.0.1:8421` |
| `token` | `string` | Yes | Daemon bearer token |
| `provider` | `string` | No | Provider tag on the audit row (default: `"orbserv"`) |
| `perCallCap` | `string` | No | Atomic per-call cap as decimal string; falls back to wallet `maxPerTx` when omitted |
| `settlementRetryAttempts` | `number` | No | Automatic retry attempts after first settlement failure (default: `3`) |
| `settlementRetryDelayMs` | `number` | No | Delay in ms between settlement retries (default: `100`) |

### `orb.wallet`

| Method | Returns | Description |
|---|---|---|
| `create(options)` | `AgentWallet` | Create a new wallet |
| `get(id)` | `AgentWallet` | Fetch an existing wallet by ID |
| `list()` | `AgentWallet[]` | List all wallets for this API key |

### `wallet` (AgentWallet)

| Method / Property | Returns | Description |
|---|---|---|
| `id` | `string` | Wallet ID |
| `name` | `string` | Wallet name |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `status` | `string` | `"active"` \| `"paused"` \| `"suspended"` |
| `solana.address` | `string` | Solana address |
| `evm.address` | `string` | EVM address (0x…) |
| `send(options)` | `Transaction` | Send tokens |
| `history(options?)` | `HistoryResponse` | Paginated transaction history |
| `balance()` | `BalanceResponse` | Per-chain, per-token balances |
| `fetch(url, init?)` | `X402FetchResult` | x402 auto-pay HTTP fetch |
| `policy` | `PolicyModule` | Spending policy manager |

### `SendOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `to` | `string` | Yes | Recipient address (EVM `0x…` or Solana base58) |
| `amount` | `number` | Yes | Amount in the token's native units |
| `token` | `Token` | No | Token to send (default: `"USDC"`) |
| `chain` | `Chain` | Yes | Chain to execute the transfer on |
| `privacy` | `boolean` | No | Route through a ZK shielded layer when `true` |
| `spendDecisionId` | `string` | No | Pre-obtained Covenant decision id; skips the SDK's own authorization call when provided |

### `Transaction`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Transaction ID |
| `walletId` | `string` | Owning wallet ID |
| `type` | `string` | `"send"` \| `"receive"` \| `"x402"` |
| `chain` | `Chain` | Chain the transaction settled on |
| `token` | `Token` | Token transferred |
| `amount` | `number` | Transfer amount |
| `txHash` | `string?` | On-chain hash (absent while pending) |
| `status` | `string` | `"pending"` \| `"confirmed"` \| `"failed"` |
| `privacy` | `boolean` | Whether ZK privacy was used |
| `createdAt` | `string` | ISO 8601 timestamp |
| `spendDecisionId` | `string?` | Covenant decision id that authorized this spend, when one was used |

### `FetchOptions`

`wallet.fetch(url, init?)` accepts a `FetchOptions` object that extends the standard `RequestInit` with two additional fields:

| Field | Type | Description |
|---|---|---|
| `maxAmount` | `number` | Maximum USDC to pay for this request. If the parsed x402 challenge asks for more, the SDK aborts before authorizing or paying |
| `chain` | `Chain` | Preferred chain when the x402 challenge offers several payment options; defaults to the first accepted option |
| *(all `RequestInit` fields)* | | `method`, `headers`, `body`, etc. |

```typescript
const { response } = await wallet.fetch("https://api.service.com/paid", {
  method: "POST",
  headers: { "X-Custom": "value" },
  maxAmount: 0.10,    // abort if challenge exceeds $0.10
  chain: "base",      // prefer Base when multiple chains offered
})
```

### `X402FetchResult`

| Field | Type | Description |
|---|---|---|
| `response` | `Response` | Raw fetch Response (body unconsumed) |
| `paymentReceipt` | `string?` | Payment receipt from the `X-Payment-Receipt` header, if any |
| `amountCharged` | `number?` | Amount deducted from the wallet (USDC) |
| `spendDecisionId` | `string?` | Covenant decision id that authorized this payment, when one was used |

### `wallet.policy`

| Method | Returns | Description |
|---|---|---|
| `get()` | `PolicyData` | Read current policy |
| `update(opts)` | `PolicyData` | Update policy fields |
| `pause()` | `PolicyData` | Block all outgoing transactions |
| `resume()` | `PolicyData` | Re-enable outgoing transactions |

### `orb.x402`

| Method | Returns | Description |
|---|---|---|
| `discover(opts?)` | `X402DiscoverResponse` | Discover x402-compatible services |

### `orb.covenant` (SpendGate)

Present only when the SDK was constructed with a `covenant` config. Exposes settlement recovery helpers for operations that succeeded on-chain but failed to settle with the daemon.

| Method | Returns | Description |
|---|---|---|
| `listFailedSettlements()` | `FailedSettlementRecord[]` | List authorizations whose post-broadcast settlement failed after all retries |
| `retryFailedSettlement(decisionId)` | `Promise<boolean>` | Retry settlement for a specific decision id; returns `true` on success. Does not rebroadcast or reauthorize |
| `retryLatestFailedSettlement()` | `Promise<boolean>` | Retry the most recently failed settlement; returns `true` on success |

### `FailedSettlementRecord`

| Field | Type | Description |
|---|---|---|
| `decisionId` | `string` | Covenant decision id |
| `txHash` | `string` | On-chain transaction hash from the broadcast |
| `context` | `CovenantSettlementContext` | Full authorization facts needed for settlement |
| `lastError` | `string` | Error message from the last failed attempt |
| `attempts` | `number` | Total attempts made (initial + retries) |
| `failedAt` | `string` | ISO 8601 timestamp of the final failure |

---

## Advanced Usage

### Direct Access to Internals

The following are exported for advanced use cases such as dependency injection, testing, or building custom authorization flows:

```typescript
import {
  CovenantSpendAuthzClient,  // low-level daemon client
  SpendGate,                  // SDK glue layer wrapping the client
  logSettlementFailure,       // manually invoke the active settlement logger
} from '@orbserv-labs/orb-wallet'

import type {
  SpendAuthorizeRequest,
  SpendAuthorizationResult,
  SpendSettleRequest,
  CovenantSettlementContext,
  FailedSettlementRecord,
} from '@orbserv-labs/orb-wallet'
```

`logSettlementFailure` calls whatever logger is currently registered (default or overridden via `setCovenantSettlementLogger`). It is useful when building custom settlement flows or when you want to emit a structured failure record manually:

```typescript
import { logSettlementFailure } from '@orbserv-labs/orb-wallet'

logSettlementFailure({
  decisionId: "dec_ok_1",
  provider: "orbserv",
  network: "eip155:8453",
  asset: "0xYOUR_TOKEN_CONTRACT_ADDRESS",
  amount: "80000",
  credits: "8",
  txHash: "0xtxhash",
  error: new Error("manual retry exhausted"),
  attempts: 4,
})
```

### Custom Settlement Logger

```typescript
import {
  setCovenantSettlementLogger,
  resetCovenantSettlementLogger,
} from '@orbserv-labs/orb-wallet'

import type { CovenantSettlementFailureLog } from '@orbserv-labs/orb-wallet'

setCovenantSettlementLogger((log: CovenantSettlementFailureLog) => {
  // { decisionId, provider, network, asset, amount, credits, txHash, error, attempts }
  datadogLogger.error("covenant_settlement_failed", log)
})

// Restore default console.warn
resetCovenantSettlementLogger()
```

---

## MCP Server — Use with Claude

The `@orbserv-labs/orb-wallet` package includes an MCP server so Claude (and any MCP-compatible AI) can create wallets, send payments, and manage policies through natural conversation.

### Setup with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "orb-wallet": {
      "command": "npx",
      "args": ["-y", "-p", "@orbserv-labs/orb-wallet", "orb-wallet-mcp"],
      "env": {
        "ORB_API_KEY": "orb_your_api_key_here",
        "ORB_BASE_URL": "https://api.orbserv.co/v1",
        "COVENANT_GATEWAY_URL": "http://localhost:<COVENANT_PORT>",
        "COVENANT_TOKEN": "your_covenant_bearer_token",
        "COVENANT_PROVIDER": "orbserv",
        "COVENANT_PER_CALL_CAP": "100000"
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
|---|---|
| `create_wallet` | Create a new agent wallet |
| `list_wallets` | List all wallets |
| `get_wallet` | Get a wallet by ID |
| `send_payment` | Send payment (set `private: true` for ZK privacy) |
| `get_balance` | Get wallet balance |
| `set_policy` | Set spending guardrails |
| `discover_services` | Discover x402-compatible services |

### Privacy Mode

```
You: Send 5 USDC to 0x123... from my agent wallet, keep it private.
Claude: [calls send_payment with private: true] ✓ Payment sent with ZK privacy enabled.
```

---

## Custody Model

Wallets created through the orbserv SDK are **non-custodial by orbserv** — private keys are held exclusively by [Privy](https://privy.io) in their HSM (Hardware Security Module). orbserv never stores or sees private keys.

```
SDK / Agent
    ↓  orb.wallet.create()
orbserv API
    ↓  privy.wallets().create({ chain_type: 'ethereum' })
Privy HSM  ← private key lives here only
    ↓  returns address + wallet ID
orbserv DB  ← stores address + Privy wallet ID (no private key)
    ↓
SDK receives real on-chain addresses
```

When an agent sends a transaction:

```
SDK  →  POST /wallets/:id/send  →  orbserv backend
                                         ↓
                                   privy.wallets().rpc(walletId, ...)
                                         ↓
                                   Privy signs & broadcasts
                                         ↓
                                   Returns tx hash
```

This means:

- **Your agents get real on-chain addresses** (EVM + Solana) backed by Privy key management
- **No key management burden** — you don't need to store, rotate, or secure private keys
- **Non-custodial by orbserv** — even orbserv itself cannot move funds without Privy
- **Spending policies enforced server-side** — guardrails cannot be bypassed by SDK callers

---

## License

[MIT](https://opensource.org/licenses/MIT)
