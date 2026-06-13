# orb-wallet

**`@orbserv-labs/orb-wallet`** — TypeScript SDK for the orbserv agent wallet API.
Give your AI agents a multi-chain crypto wallet with built-in spending policies and x402 auto-pay in minutes.

---

## Installation

```bash
npm install @orbserv-labs/orb-wallet
# or
pnpm add @orbserv-labs/orb-wallet
# or
yarn add @orbserv-labs/orb-wallet
```

**Requirements**: Node.js >= 18 (uses native `fetch`). No runtime dependencies.

---

## Quick start

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

## Policy management

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

## x402 service discovery

```typescript
// Discover x402-compatible services on the orbserv marketplace
const services = await orb.x402.discover({ category: "inference" })
services.services.forEach(s => console.log(s.name, s.baseUrl))
```

---

## Covenant spend authorization (optional)

Beside the server-side spending policy, the SDK can ask a [Covenant](https://github.com/open-covenant/covenant/blob/feat/spend-authorization/docs/spend-authorization.md) daemon to authorize each spend *before* it is signed. The daemon checks the caller's capability, a per-call cap, and the payer's budget, records the verdict in its audit chain, and returns approve or deny with a `decision_id`. No funds move — it is a decision, not a payment. The `decision_id` is forwarded to the orbserv API so a later settlement can be correlated back to the authorization.

This is fully optional. Omit the `covenant` config and the SDK behaves exactly as before, relying only on the server-side policy guardrails.

### Enable the daemon

The Covenant operator opts in at boot:

```bash
# In the daemon environment
export COVENANT_SPEND_AUTHZ_ENABLED=1

# Grant the calling identity the capability
covenant capabilities grant wallet.spend.authorize
```

Smoke-test the contract before pointing the SDK at it:

```bash
curl -sS -X POST http://127.0.0.1:8421/spend/authorize \
  -H "Authorization: Bearer $COVENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "orbserv",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
    gatewayUrl: "http://127.0.0.1:8421",   // daemon base URL
    token: process.env.COVENANT_TOKEN!,    // daemon bearer token
    // perCallCap is an atomic decimal string; when omitted, the wallet
    // policy's maxPerTx is used as the per-call cap instead.
    perCallCap: "100000",
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

The daemon is the authority. Set the wallet's own `policy.maxPerTx` to mirror `perCallCap` as a hard backstop, so a spend can never exceed the bound even if a call skips the pre-flight.

### Settlement

After a broadcast succeeds, the SDK closes the audit loop automatically with `POST /spend/settle`, joining the authorization (`decision_id`) to the on-chain transaction (`tx_sig`). The daemon does not reconstruct spend details from the decision id, so the SDK caches the authorization facts at authorize time and resends the full payload (`provider`, `network`, `asset`, `amount`, `credits`) with the transaction hash.

Settlement is post-transaction accounting. Once the transaction has been broadcast, the payment is complete — a settlement failure is logged with the full spend facts (`decisionId`, `provider`, `network`, `asset`, `amount`, `credits`, `txHash`) and **never** rolls back, throws, or marks the payment failed. Use the logged facts and `CovenantSpendAuthzClient.settleSpend(decisionId, txHash)` to retry a failed settlement manually:

```typescript
import { CovenantSpendAuthzClient } from "@orbserv-labs/orb-wallet"

const covenant = new CovenantSpendAuthzClient({
  gatewayUrl: "http://127.0.0.1:8421",
  token: process.env.COVENANT_TOKEN!,
})

// Retry settlement for a spend this client authorized earlier
await covenant.settleSpend(decisionId, txHash)
```

A denied authorization always throws `OrbSpendDeniedError` **before** the transfer request is sent — a denied spend can never reach broadcast, so there is never anything to settle on a deny.

### Local test checklist

1. Start the daemon with `COVENANT_SPEND_AUTHZ_ENABLED=1`.
2. Grant the capability: `covenant capabilities grant wallet.spend.authorize`.
3. Verify the contract with the curl example above.
4. Point the SDK at the daemon via the `covenant` config.
5. Run a send within the cap (approve) and one above it (deny).
6. Inspect the audit chain: `covenant audit recent` shows `spend_authorization_decided` rows.

---

## Wallet management

```typescript
// Retrieve an existing wallet by ID
const wallet = await orb.wallet.get("wal_abc123")

// List all wallets for this API key
const wallets = await orb.wallet.list()
```

---

## Error handling

```typescript
import { OrbApiError, OrbAuthError } from '@orbserv-labs/orb-wallet'

try {
  const wallet = await orb.wallet.create({ name: "agent", chains: ["base"] })
} catch (err) {
  if (err instanceof OrbAuthError) {
    // 401 or 403 — check your API key
    console.error("Auth failed:", err.statusCode, err.body)
  } else if (err instanceof OrbApiError) {
    // Any other non-2xx response
    console.error("API error:", err.statusCode, err.body)
  } else {
    throw err
  }
}
```

---

## API reference

### `new OrbWallet(options)`

| Option     | Type     | Required | Description                                           |
|------------|----------|----------|-------------------------------------------------------|
| `apiKey`   | `string` | Yes      | Your orbserv API key                                  |
| `baseUrl`  | `string` | No       | Override base URL (default: `https://api.orbserv.co/v1`) |
| `covenant` | `CovenantSpendAuthzConfig` | No | Enable the Covenant spend-authorization gate (see above) |

### `orb.wallet`

| Method                    | Returns          | Description                         |
|---------------------------|------------------|-------------------------------------|
| `create(options)`         | `AgentWallet`    | Create a new wallet                 |
| `get(id)`                 | `AgentWallet`    | Fetch an existing wallet by ID      |
| `list()`                  | `AgentWallet[]`  | List all wallets for this API key   |

### `wallet` (AgentWallet)

| Method / Property         | Returns              | Description                                   |
|---------------------------|----------------------|-----------------------------------------------|
| `id`                      | `string`             | Wallet ID                                     |
| `name`                    | `string`             | Wallet name                                   |
| `solana.address`          | `string`             | Solana address                                |
| `evm.address`             | `string`             | EVM address (0x…)                             |
| `send(options)`           | `Transaction`        | Send tokens                                   |
| `history(options?)`       | `HistoryResponse`    | Paginated transaction history                 |
| `balance()`               | `BalanceResponse`    | Per-chain, per-token balances                 |
| `fetch(url, init?)`       | `X402FetchResult`    | x402 auto-pay HTTP fetch                      |
| `policy`                  | `PolicyModule`       | Spending policy manager                       |

### `wallet.policy`

| Method           | Returns       | Description                        |
|------------------|---------------|------------------------------------|
| `get()`          | `PolicyData`  | Read current policy                |
| `update(opts)`   | `PolicyData`  | Update policy fields               |
| `pause()`        | `PolicyData`  | Block all outgoing transactions    |
| `resume()`       | `PolicyData`  | Re-enable outgoing transactions    |

### `orb.x402`

| Method             | Returns                  | Description                         |
|--------------------|--------------------------|-------------------------------------|
| `discover(opts?)`  | `X402DiscoverResponse`   | Discover x402-compatible services   |

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
      "args": ["-y", "@orbserv-labs/orb-wallet", "orb-wallet-mcp"],
      "env": {
        "ORB_API_KEY": "orb_your_api_key_here",
        "ORB_BASE_URL": "https://api.orbserv.co/v1",
        "COVENANT_GATEWAY_URL": "http://127.0.0.1:8421",
        "COVENANT_TOKEN": "your_covenant_bearer_token"
      }
    }
  }
}
```

### Available tools

| Tool | Description |
|---|---|
| `create_wallet` | Create a new agent wallet |
| `list_wallets` | List all wallets |
| `get_wallet` | Get a wallet by ID |
| `send_payment` | Send payment (set `private: true` for ZK privacy) |
| `get_balance` | Get wallet balance |
| `set_policy` | Set spending guardrails |
| `discover_services` | Discover x402-compatible services |

### Privacy mode

```
You: Send 5 USDC to 0x123... from my agent wallet, keep it private.
Claude: [calls send_payment with private: true] ✓ Payment sent with ZK privacy enabled.
```

---

## Custody model

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

MIT
