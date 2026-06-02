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
        "ORB_BASE_URL": "https://api.orbserv.co/v1"
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
