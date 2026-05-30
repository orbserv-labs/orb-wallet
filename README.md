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

| Option    | Type     | Required | Description                                           |
|-----------|----------|----------|-------------------------------------------------------|
| `apiKey`  | `string` | Yes      | Your orbserv API key                                  |
| `baseUrl` | `string` | No       | Override base URL (default: `https://api.orbserv.co/v1`) |

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

## License

MIT
