#!/usr/bin/env node
/**
 * MCP stdio server for @orbserv-labs/orb-wallet.
 *
 * Exposes the orbserv SDK as tools that Claude (and any MCP-compatible AI)
 * can call in natural-language conversations.
 *
 * Environment variables:
 *   ORB_API_KEY   – required; your orbserv API key
 *   ORB_BASE_URL  – optional; defaults to https://api.orbserv.co/v1
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { OrbWallet } from '@orbserv-labs/orb-wallet';

// ---------------------------------------------------------------------------
// SDK client — lazy so the server starts even without ORB_API_KEY
// ---------------------------------------------------------------------------

const NO_KEY_MSG =
  '❌ ORB_API_KEY is not set.\n\n' +
  'To use the orb-wallet MCP:\n' +
  '1. Sign in at https://app.orbserv.co\n' +
  '2. Go to API Keys → Create key\n' +
  '3. Add ORB_API_KEY to your MCP config env\n\n' +
  'Example .mcp.json:\n' +
  '{\n' +
  '  "mcpServers": {\n' +
  '    "orb-wallet": {\n' +
  '      "command": "npx",\n' +
  '      "args": ["-y", "-p", "@orbserv-labs/orb-wallet", "orb-wallet-mcp"],\n' +
  '      "env": { "ORB_API_KEY": "orb_your_key_here" }\n' +
  '    }\n' +
  '  }\n' +
  '}';

let _orb: OrbWallet | null = null;

function getOrb(): OrbWallet {
  if (!process.env.ORB_API_KEY) throw new Error(NO_KEY_MSG);
  if (!_orb) {
    _orb = new OrbWallet({
      apiKey: process.env.ORB_API_KEY,
      baseUrl: process.env.ORB_BASE_URL ?? 'https://api.orbserv.co/v1',
    });
  }
  return _orb;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'orb-wallet', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_wallet',
      description: 'Create a new agent wallet with EVM and Solana addresses',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Human-readable label for the wallet',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_wallets',
      description: 'List all wallets for your API key',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_wallet',
      description: 'Get a wallet by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The wallet ID (e.g. wal_abc123)',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'send_payment',
      description:
        'Send a payment from a wallet. Set private: true to use ZK privacy mode — hides sender, amount, and recipient on-chain.',
      inputSchema: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID to send from',
          },
          to: {
            type: 'string',
            description: 'Recipient address (EVM 0x… or Solana base58)',
          },
          amount: {
            type: 'number',
            description: 'Amount to send in the specified token',
          },
          token: {
            type: 'string',
            description: 'Token to send (e.g. USDC, ETH, SOL, USDT)',
          },
          chain: {
            type: 'string',
            description: 'Chain to execute the transfer on (e.g. base, solana, ethereum, arbitrum)',
          },
          private: {
            type: 'boolean',
            description: 'When true, routes through a ZK shielded layer for privacy',
          },
        },
        required: ['walletId', 'to', 'amount', 'token', 'chain'],
      },
    },
    {
      name: 'get_balance',
      description: 'Get the balance of a wallet',
      inputSchema: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID',
          },
        },
        required: ['walletId'],
      },
    },
    {
      name: 'set_policy',
      description:
        'Set spending guardrails on a wallet — daily limits, per-tx limits, allowed services',
      inputSchema: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID',
          },
          dailyLimit: {
            type: 'number',
            description: 'Maximum cumulative USDC spend per 24-hour rolling window',
          },
          maxPerTx: {
            type: 'number',
            description: 'Maximum USDC spend allowed in a single transaction',
          },
          whitelist: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allow-list of service categories or tags (e.g. "x402", "inference")',
          },
        },
        required: ['walletId'],
      },
    },
    {
      name: 'discover_services',
      description:
        'Discover x402-compatible services that agents can pay and use automatically',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by service category (e.g. "inference", "data", "storage")',
          },
        },
        required: [],
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === 'create_wallet') {
      const { name: walletName } = args as { name: string };
      const wallet = await getOrb().wallet.create({
        name: walletName,
        chains: ['solana', 'base', 'ethereum', 'arbitrum'],
      });
      result = {
        name:      wallet.name,
        status:    wallet.status,
        evm:       wallet.evm?.address    ?? null,
        solana:    wallet.solana?.address ?? null,
        createdAt: wallet.createdAt,
        // internal ID — needed for follow-up operations
        _id:       wallet.id,
      };
    } else if (name === 'list_wallets') {
      const wallets = await getOrb().wallet.list();
      result = wallets.map((w) => ({
        name:      w.name,
        status:    w.status,
        evm:       w.evm?.address    ?? null,
        solana:    w.solana?.address ?? null,
        createdAt: w.createdAt,
        _id:       w.id,
      }));
    } else if (name === 'get_wallet') {
      const { id } = args as { id: string };
      const wallet = await getOrb().wallet.get(id);
      result = {
        name:      wallet.name,
        status:    wallet.status,
        evm:       wallet.evm?.address    ?? null,
        solana:    wallet.solana?.address ?? null,
        createdAt: wallet.createdAt,
        _id:       wallet.id,
      };
    } else if (name === 'send_payment') {
      const { walletId, to, amount, token, chain, private: usePrivacy } = args as {
        walletId: string;
        to: string;
        amount: number;
        token: string;
        chain: string;
        private?: boolean;
      };
      const wallet = await getOrb().wallet.get(walletId);
      result = await wallet.send({
        to,
        amount,
        token:   token as import('@orbserv-labs/orb-wallet').Token,
        chain:   chain as import('@orbserv-labs/orb-wallet').Chain,
        privacy: usePrivacy ?? false,
      });
    } else if (name === 'get_balance') {
      const { walletId } = args as { walletId: string };
      const wallet = await getOrb().wallet.get(walletId);
      result = await wallet.balance();
    } else if (name === 'set_policy') {
      const { walletId, dailyLimit, maxPerTx, whitelist } = args as {
        walletId: string;
        dailyLimit?: number;
        maxPerTx?: number;
        whitelist?: string[];
      };
      const wallet = await getOrb().wallet.get(walletId);
      result = await wallet.policy.update({ dailyLimit, maxPerTx, whitelist });
    } else if (name === 'discover_services') {
      const { category } = (args ?? {}) as { category?: string };
      result = await getOrb().x402.discover({ category });
    } else {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `Error: ${(err as Error).message}` },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
