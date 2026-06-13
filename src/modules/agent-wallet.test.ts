import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentWallet } from "./agent-wallet.js";
import { HttpClient } from "../utils/http.js";
import { CovenantSpendAuthzClient, SpendGate } from "../utils/covenant.js";
import { OrbSpendDeniedError } from "../utils/errors.js";
import type { WalletData } from "../types.js";

interface RecordedCall {
  url: string;
  body: unknown;
}

/** Replace global fetch with a URL-routed stub; returns recorded calls. */
function stubFetch(
  routes: Record<string, (body: unknown) => { status: number; json: unknown }>
) {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    for (const [suffix, handler] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        const { status, json } = handler(body);
        return new Response(JSON.stringify(json), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: `no route for ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** Capture console.warn calls; returns the recorded arguments. */
function spyWarn() {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  return { warnings, restore: () => (console.warn = original) };
}

const WALLET_DATA: WalletData = {
  id: "w1",
  name: "test-wallet",
  createdAt: "2026-01-01T00:00:00Z",
  status: "active",
  policy: {},
  evm: { address: "0xWallet", chain: "base" },
};

function makeWallet() {
  const http = new HttpClient("http://api.test", "orb_key");
  const gate = new SpendGate(
    new CovenantSpendAuthzClient({
      gatewayUrl: "http://covenant.test:8421",
      token: "tok",
      perCallCap: "100000",
    }),
    http
  );
  return new AgentWallet(WALLET_DATA, http, gate);
}

const SEND_OPTIONS = {
  to: "0xPayee",
  amount: 0.08,
  token: "USDC" as const,
  chain: "base" as const,
};

const TX_RESPONSE = {
  id: "tx-1",
  walletId: "w1",
  type: "send",
  chain: "base",
  token: "USDC",
  amount: 0.08,
  status: "confirmed",
  privacy: false,
  createdAt: "2026-01-01T00:00:00Z",
  txHash: "0xBroadcastHash",
};

test("denied authorization throws OrbSpendDeniedError and never broadcasts", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: {
        kind: "spend_authorized",
        approved: false,
        decision_id: "dec-deny",
        reason: "amount exceeds the per-call cap",
      },
    }),
  });
  try {
    const wallet = makeWallet();
    await assert.rejects(wallet.send(SEND_OPTIONS), OrbSpendDeniedError);

    const broadcastCalls = fetchStub.calls.filter((c) =>
      c.url.includes("/wallets/w1/send")
    );
    assert.equal(broadcastCalls.length, 0, "broadcast must never be reached");
  } finally {
    fetchStub.restore();
  }
});

test("approved spend broadcasts then settles with the full payload", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-ok" },
    }),
    "/wallets/w1/send": () => ({ status: 200, json: TX_RESPONSE }),
    "/spend/settle": () => ({ status: 200, json: { kind: "spend_settled" } }),
  });
  try {
    const wallet = makeWallet();
    const tx = await wallet.send(SEND_OPTIONS);
    assert.equal(tx.txHash, "0xBroadcastHash");

    const settleCalls = fetchStub.calls.filter((c) =>
      c.url.endsWith("/spend/settle")
    );
    assert.equal(settleCalls.length, 1, "settle called exactly once");

    const authorizeCall = fetchStub.calls.find((c) =>
      c.url.endsWith("/spend/authorize")
    );
    const authorizeBody = authorizeCall!.body as Record<string, unknown>;
    assert.deepEqual(settleCalls[0].body, {
      decision_id: "dec-ok",
      provider: authorizeBody.provider,
      network: authorizeBody.network,
      asset: authorizeBody.asset,
      amount: authorizeBody.amount,
      credits: authorizeBody.credits,
      tx_sig: "0xBroadcastHash",
    });
  } finally {
    fetchStub.restore();
  }
});

test("settlement failure is logged and never affects the tx result", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-sf" },
    }),
    "/wallets/w1/send": () => ({ status: 200, json: TX_RESPONSE }),
    "/spend/settle": () => ({ status: 500, json: { error: "daemon down" } }),
  });
  const warnSpy = spyWarn();
  try {
    const wallet = makeWallet();
    const tx = await wallet.send(SEND_OPTIONS);

    // The payment still succeeds despite the settle failure.
    assert.equal(tx.txHash, "0xBroadcastHash");
    assert.equal(tx.status, "confirmed");

    // The failure is observable with the facts needed for a later retry.
    assert.equal(warnSpy.warnings.length, 1);
    const [message, context] = warnSpy.warnings[0] as [
      string,
      Record<string, unknown>
    ];
    assert.match(message, /Failed to settle Covenant authorization/);
    assert.equal(context.decisionId, "dec-sf");
    assert.equal(context.txHash, "0xBroadcastHash");
    assert.equal(context.amount, "80000");
    assert.equal(context.credits, 8);
    assert.equal(context.network, "eip155:8453");
  } finally {
    warnSpy.restore();
    fetchStub.restore();
  }
});

test("pending transaction without a hash skips settlement with a warning", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-p" },
    }),
    "/wallets/w1/send": () => ({
      status: 200,
      json: { ...TX_RESPONSE, txHash: undefined, status: "pending" },
    }),
  });
  const warnSpy = spyWarn();
  try {
    const wallet = makeWallet();
    const tx = await wallet.send(SEND_OPTIONS);
    assert.equal(tx.status, "pending");

    const settleCalls = fetchStub.calls.filter((c) =>
      c.url.endsWith("/spend/settle")
    );
    assert.equal(settleCalls.length, 0, "no settle without a tx hash");
    assert.equal(warnSpy.warnings.length, 1);
  } finally {
    warnSpy.restore();
    fetchStub.restore();
  }
});
