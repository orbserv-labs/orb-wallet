// Covenant spend-authorization tests.
//
// Runs the built SDK (dist/) against three in-process HTTP servers:
//   - a mock orbserv API   (wallet data, policy, /send, /x402/fetch)
//   - a mock Covenant daemon (POST /spend/authorize)
//   - a mock x402 service    (returns 402 challenges or 200)
//
// Usage: npm test   (builds first, then `node --test test/`)

import { test, describe, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { OrbWallet } from "../dist/index.js";
import {
  OrbCovenantError,
  OrbSpendDeniedError,
} from "../dist/utils/errors.js";
import {
  setCovenantSettlementLogger,
  resetCovenantSettlementLogger,
} from "../dist/utils/covenant-logger.js";
import {
  toAtomicString,
  creditsFor,
  creditsFromAtomicUsdc,
  CHAIN_TO_CAIP2,
  USDC_ADDRESS,
} from "../dist/utils/chain-assets.js";

// ---------------------------------------------------------------------------
// Mock servers
// ---------------------------------------------------------------------------

const WALLET_ID = "wal_test_1";

const walletData = {
  id: WALLET_ID,
  name: "covenant-test",
  createdAt: "2026-06-12T00:00:00Z",
  evm: { address: "0xAgentAddress", chain: "base" },
  solana: { address: "AgentSolAddress", chain: "solana" },
  policy: {},
  status: "active",
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? JSON.parse(data) : null));
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`)
    );
  });
}

// Mock orbserv API ----------------------------------------------------------

const api = {
  server: null,
  url: "",
  // mutable per-test state
  policyResponse: null, // null -> 404
  policyHits: 0,
  sendBodies: [],
  x402Bodies: [],
};

api.server = createServer(async (req, res) => {
  const body = await readBody(req);
  const json = (status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "GET" && req.url === `/v1/wallets/${WALLET_ID}`) {
    return json(200, walletData);
  }
  if (req.method === "GET" && req.url === `/v1/wallets/${WALLET_ID}/policy`) {
    api.policyHits++;
    if (!api.policyResponse) return json(404, { error: "no policy" });
    return json(200, api.policyResponse);
  }
  if (req.method === "PATCH" && req.url === `/v1/wallets/${WALLET_ID}/policy`) {
    api.policyResponse = { ...api.policyResponse, ...body };
    return json(200, api.policyResponse);
  }
  if (req.method === "POST" && req.url === `/v1/wallets/${WALLET_ID}/send`) {
    api.sendBodies.push(body);
    return json(200, {
      id: "tx_1",
      walletId: WALLET_ID,
      type: "send",
      chain: body.chain,
      token: body.token,
      amount: body.amount,
      to: body.to,
      status: "confirmed",
      privacy: body.privacy,
      createdAt: "2026-06-12T00:00:00Z",
      txHash: "0xtxhash_approved",
      spendDecisionId: body.spendAuthorization?.decisionId,
    });
  }
  if (req.method === "POST" && req.url === "/v1/x402/fetch") {
    api.x402Bodies.push(body);
    return json(200, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
      paymentReceipt: "receipt-abc",
      amountCharged: 0.08,
      spendDecisionId: body.spendAuthorization?.decisionId,
    });
  }
  json(404, { error: `unhandled ${req.method} ${req.url}` });
});

// Mock Covenant daemon ------------------------------------------------------

const daemon = {
  server: null,
  url: "",
  authorizeResponse: { status: 200, body: {} },
  settleResponse: { status: 200, body: { kind: "spend_settled" } },
  authorizeRequests: [],
  settleRequests: [],
};

daemon.server = createServer(async (req, res) => {
  const body = await readBody(req);
  if (req.method === "POST" && req.url === "/spend/authorize") {
    daemon.authorizeRequests.push({ headers: req.headers, body });
    res.writeHead(daemon.authorizeResponse.status, {
      "Content-Type": "application/json",
    });
    return res.end(JSON.stringify(daemon.authorizeResponse.body));
  }
  if (req.method === "POST" && req.url === "/spend/settle") {
    daemon.settleRequests.push({ headers: req.headers, body });
    res.writeHead(daemon.settleResponse.status, {
      "Content-Type": "application/json",
    });
    return res.end(JSON.stringify(daemon.settleResponse.body));
  }
  res.writeHead(404).end();
});

// Mock x402 service ---------------------------------------------------------

const x402svc = {
  server: null,
  url: "",
  // mutable per-test state
  mode: "challenge", // "challenge" | "free"
  challenge: null,
  hits: 0,
};

x402svc.server = createServer(async (req, res) => {
  await readBody(req);
  x402svc.hits++;
  if (x402svc.mode === "free") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: "no payment needed" }));
  }
  const header = Buffer.from(JSON.stringify(x402svc.challenge)).toString(
    "base64"
  );
  res.writeHead(402, {
    "Content-Type": "application/json",
    "PAYMENT-REQUIRED": header,
  });
  res.end(JSON.stringify({ error: "payment required" }));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APPROVED = {
  status: 200,
  body: { kind: "spend.decision", approved: true, decision_id: "dec_ok_1" },
};

function makeOrb(covenantOverrides = {}) {
  return new OrbWallet({
    apiKey: "sk_test_123",
    baseUrl: `${api.url}/v1`,
    covenant: {
      gatewayUrl: daemon.url,
      token: "operator-token",
      settlementRetryAttempts: 0,
      settlementRetryDelayMs: 0,
      ...covenantOverrides,
    },
  });
}

before(async () => {
  api.url = await listen(api.server);
  daemon.url = await listen(daemon.server);
  x402svc.url = await listen(x402svc.server);
});

after(() => {
  api.server.close();
  daemon.server.close();
  x402svc.server.close();
});

beforeEach(() => {
  api.policyResponse = null;
  api.policyHits = 0;
  api.sendBodies = [];
  api.x402Bodies = [];
  daemon.authorizeResponse = APPROVED;
  daemon.settleResponse = { status: 200, body: { kind: "spend_settled" } };
  daemon.authorizeRequests = [];
  daemon.settleRequests = [];
  resetCovenantSettlementLogger();
  x402svc.mode = "challenge";
  x402svc.challenge = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "80000",
        asset: USDC_ADDRESS.base,
        payTo: "0xServiceAddress",
      },
    ],
  };
  x402svc.hits = 0;
});

// ---------------------------------------------------------------------------
// Unit: atomic-amount and credit math
// ---------------------------------------------------------------------------

describe("chain-assets math", () => {
  test("toAtomicString avoids IEEE-754 drift (0.07 USDC)", () => {
    assert.equal(toAtomicString(0.07, "USDC"), "70000");
  });

  test("toAtomicString handles whole and fractional amounts", () => {
    assert.equal(toAtomicString(5, "USDC"), "5000000");
    assert.equal(toAtomicString(0.08, "USDC"), "80000");
    assert.equal(toAtomicString(0, "USDC"), "0");
    assert.equal(toAtomicString(1.5, "ETH"), "1500000000000000000");
    assert.equal(toAtomicString(2, "SOL"), "2000000000");
  });

  test("credits: $0.08 USDC -> 8 credits, both derivations agree", () => {
    assert.equal(creditsFor(0.08, "USDC"), 8);
    assert.equal(creditsFromAtomicUsdc("80000"), 8);
  });

  test("credits: non-stable tokens report 0 (no guessed peg)", () => {
    assert.equal(creditsFor(1.5, "ETH"), 0);
  });
});

// ---------------------------------------------------------------------------
// send() through the spend gate
// ---------------------------------------------------------------------------

describe("AgentWallet.send() with Covenant gate", () => {
  test("approve: daemon receives the spec-shaped request, decisionId reaches the API", async () => {
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    const tx = await wallet.send({
      to: "0xRecipient",
      amount: 0.08,
      token: "USDC",
      chain: "base",
    });

    // Daemon saw exactly one authorize call with the Covenant request shape.
    assert.equal(daemon.authorizeRequests.length, 1);
    const { headers, body } = daemon.authorizeRequests[0];
    assert.equal(headers.authorization, "Bearer operator-token");
    assert.deepEqual(body, {
      provider: "orbserv",
      network: CHAIN_TO_CAIP2.base,
      asset: USDC_ADDRESS.base,
      amount: "80000",
      per_call_cap: "1000000",
      credits: 8,
      destination: "0xRecipient",
    });

    // The API send call carried the decision id for audit correlation.
    assert.equal(api.sendBodies.length, 1);
    assert.deepEqual(api.sendBodies[0].spendAuthorization, {
      decisionId: "dec_ok_1",
    });
    assert.equal(tx.spendDecisionId, "dec_ok_1");

    // Post-broadcast settlement uses the exact authorization facts.
    assert.equal(daemon.settleRequests.length, 1);
    assert.deepEqual(daemon.settleRequests[0].body, {
      decision_id: "dec_ok_1",
      provider: "orbserv",
      network: CHAIN_TO_CAIP2.base,
      asset: USDC_ADDRESS.base,
      amount: "80000",
      credits: "8",
      tx_sig: "0xtxhash_approved",
    });
  });

  test("deny: throws OrbSpendDeniedError and never hits the API", async () => {
    daemon.authorizeResponse = {
      status: 200,
      body: {
        kind: "spend.decision",
        approved: false,
        decision_id: "dec_deny_1",
        reason: "per_call_cap_exceeded",
      },
    };
    const orb = makeOrb({ perCallCap: "1000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 5, token: "USDC", chain: "base" }),
      (err) => {
        assert.ok(err instanceof OrbSpendDeniedError);
        assert.equal(err.decisionId, "dec_deny_1");
        assert.match(err.message, /per_call_cap_exceeded/);
        return true;
      }
    );
    assert.equal(api.sendBodies.length, 0, "API /send must not be called");
  });

  test("daemon error body: throws OrbCovenantError, API untouched", async () => {
    daemon.authorizeResponse = { status: 500, body: { error: "capability expired" } };
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" }),
      (err) => {
        assert.ok(err instanceof OrbCovenantError);
        assert.match(err.message, /capability expired/);
        return true;
      }
    );
    assert.equal(api.sendBodies.length, 0);
  });

  test("daemon unreachable: throws OrbCovenantError, API untouched", async () => {
    const orb = new OrbWallet({
      apiKey: "sk_test_123",
      baseUrl: `${api.url}/v1`,
      covenant: {
        gatewayUrl: "http://127.0.0.1:1", // nothing listens here
        token: "operator-token",
        perCallCap: "1000000",
      },
    });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" }),
      OrbCovenantError
    );
    assert.equal(api.sendBodies.length, 0);
  });

  test("malformed approval (missing decision_id): throws OrbCovenantError", async () => {
    daemon.authorizeResponse = { status: 200, body: { approved: true } };
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" }),
      /missing decision_id/
    );
  });

  test("pre-obtained spendDecisionId skips the daemon entirely", async () => {
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await wallet.send({
      to: "0xR",
      amount: 1,
      token: "USDC",
      chain: "base",
      spendDecisionId: "dec_external_9",
    });

    assert.equal(daemon.authorizeRequests.length, 0);
    assert.deepEqual(api.sendBodies[0].spendAuthorization, {
      decisionId: "dec_external_9",
    });
  });

  test("no covenant config: send goes straight to the API, no gate", async () => {
    const orb = new OrbWallet({ apiKey: "sk_test_123", baseUrl: `${api.url}/v1` });
    const wallet = await orb.wallet.get(WALLET_ID);

    await wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" });

    assert.equal(daemon.authorizeRequests.length, 0);
    assert.equal(api.sendBodies.length, 1);
    assert.equal(api.sendBodies[0].spendAuthorization, undefined);
  });
});

// ---------------------------------------------------------------------------
// per-call cap resolution
// ---------------------------------------------------------------------------

describe("per-call cap fallback to wallet policy", () => {
  test("uses policy maxPerTx (atomic) when perCallCap is unset, and caches it", async () => {
    api.policyResponse = {
      walletId: WALLET_ID,
      dailyLimit: 100,
      maxPerTx: 10,
      whitelist: [],
      alertAbove: 50,
      status: "active",
      updatedAt: "2026-06-12T00:00:00Z",
    };
    const orb = makeOrb(); // no perCallCap
    const wallet = await orb.wallet.get(WALLET_ID);

    await wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" });
    await wallet.send({ to: "0xR", amount: 2, token: "USDC", chain: "base" });

    assert.equal(daemon.authorizeRequests[0].body.per_call_cap, "10000000"); // 10 USDC atomic
    assert.equal(daemon.authorizeRequests[1].body.per_call_cap, "10000000");
    assert.equal(api.policyHits, 1, "policy endpoint should be cached after first read");
  });

  test("policy.update() invalidates the cached cap", async () => {
    api.policyResponse = {
      walletId: WALLET_ID,
      dailyLimit: 100,
      maxPerTx: 10,
      whitelist: [],
      alertAbove: 50,
      status: "active",
      updatedAt: "2026-06-12T00:00:00Z",
    };
    const orb = makeOrb(); // no perCallCap -> derive from policy
    const wallet = await orb.wallet.get(WALLET_ID);

    await wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" });
    assert.equal(daemon.authorizeRequests[0].body.per_call_cap, "10000000");

    await wallet.policy.update({ maxPerTx: 2 });

    await wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" });
    assert.equal(
      daemon.authorizeRequests[1].body.per_call_cap,
      "2000000",
      "second send must authorize against the updated maxPerTx"
    );
    assert.equal(api.policyHits, 2, "policy re-read after the update");
  });

  test("policy endpoint missing (404): clear configuration error, no spend", async () => {
    const orb = makeOrb(); // no perCallCap, api.policyResponse = null -> 404
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" }),
      (err) => {
        assert.ok(err instanceof OrbCovenantError);
        assert.match(err.message, /perCallCap|maxPerTx/);
        return true;
      }
    );
    assert.equal(daemon.authorizeRequests.length, 0);
    assert.equal(api.sendBodies.length, 0);
  });

  test("policy present but maxPerTx null: configuration error", async () => {
    api.policyResponse = {
      walletId: WALLET_ID,
      dailyLimit: 100,
      maxPerTx: null,
      whitelist: [],
      alertAbove: 50,
      status: "active",
      updatedAt: "2026-06-12T00:00:00Z",
    };
    const orb = makeOrb();
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 1, token: "USDC", chain: "base" }),
      /no maxPerTx/
    );
  });
});

// ---------------------------------------------------------------------------
// x402 auto-pay through the spend gate
// ---------------------------------------------------------------------------

describe("wallet.fetch() (x402) with Covenant gate", () => {
  test("402 challenge: authorized with the challenge's own network/asset/amount", async () => {
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    const result = await wallet.fetch(`${x402svc.url}/paid-endpoint`);

    assert.equal(daemon.authorizeRequests.length, 1);
    const { body } = daemon.authorizeRequests[0];
    assert.equal(body.network, "eip155:8453");
    assert.equal(body.asset, USDC_ADDRESS.base);
    assert.equal(body.amount, "80000");
    assert.equal(body.credits, 8);
    assert.equal(body.destination, "0xServiceAddress");

    // Backend proxy received the decision id; result surfaces it.
    assert.equal(api.x402Bodies.length, 1);
    assert.deepEqual(api.x402Bodies[0].spendAuthorization, {
      decisionId: "dec_ok_1",
    });
    assert.equal(result.spendDecisionId, "dec_ok_1");
    assert.equal(result.paymentReceipt, "receipt-abc");
    assert.equal(result.response.status, 200);

    assert.equal(daemon.settleRequests.length, 1);
    assert.equal(daemon.settleRequests[0].body.tx_sig, "receipt-abc");
    assert.equal(daemon.settleRequests[0].body.decision_id, "dec_ok_1");
  });

  test("no payment required: returns probe response, daemon and backend untouched", async () => {
    x402svc.mode = "free";
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    const result = await wallet.fetch(`${x402svc.url}/free-endpoint`);

    assert.equal(result.response.status, 200);
    assert.deepEqual(await result.response.json(), {
      data: "no payment needed",
    });
    assert.equal(daemon.authorizeRequests.length, 0);
    assert.equal(api.x402Bodies.length, 0);
  });

  test("maxAmount backstop: challenge above the cap aborts before authorizing", async () => {
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.fetch(`${x402svc.url}/paid-endpoint`, { maxAmount: 0.05 }),
      (err) => {
        assert.ok(err instanceof OrbCovenantError);
        assert.match(err.message, /exceeds maxAmount/);
        return true;
      }
    );
    assert.equal(daemon.authorizeRequests.length, 0, "must abort before authorize");
    assert.equal(api.x402Bodies.length, 0, "must abort before payment");
  });

  test("denied x402 spend: throws, backend never called", async () => {
    daemon.authorizeResponse = {
      status: 200,
      body: { approved: false, decision_id: "dec_deny_2", reason: "budget_exhausted" },
    };
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.fetch(`${x402svc.url}/paid-endpoint`),
      OrbSpendDeniedError
    );
    assert.equal(api.x402Bodies.length, 0);
  });

  test("preferred chain selects the matching challenge option", async () => {
    x402svc.challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "80000",
          asset: USDC_ADDRESS.base,
          payTo: "0xBasePayTo",
        },
        {
          scheme: "exact",
          network: "eip155:42161",
          amount: "90000",
          asset: USDC_ADDRESS.arbitrum,
          payTo: "0xArbPayTo",
        },
      ],
    };
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await wallet.fetch(`${x402svc.url}/paid-endpoint`, { chain: "arbitrum" });

    const { body } = daemon.authorizeRequests[0];
    assert.equal(body.network, "eip155:42161");
    assert.equal(body.asset, USDC_ADDRESS.arbitrum);
    assert.equal(body.amount, "90000");
    assert.equal(body.destination, "0xArbPayTo");
  });

  test("unparseable 402: clear error instead of paying blind", async () => {
    x402svc.challenge = { x402Version: 2, accepts: [] };
    const orb = makeOrb({ perCallCap: "1000000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.fetch(`${x402svc.url}/paid-endpoint`),
      /could not parse an x402 payment challenge/
    );
    assert.equal(daemon.authorizeRequests.length, 0);
  });
});

// ---------------------------------------------------------------------------
// post-broadcast settlement
// ---------------------------------------------------------------------------

describe("Covenant spend settlement", () => {
  test("settlement failure: broadcast succeeds, tx returned, failure logged", async () => {
    const failures = [];
    setCovenantSettlementLogger((log) => failures.push(log));

    daemon.settleResponse = { status: 500, body: { error: "settlement offline" } };
    const orb = makeOrb({ perCallCap: "1000000", settlementRetryAttempts: 0 });
    const wallet = await orb.wallet.get(WALLET_ID);

    const tx = await wallet.send({
      to: "0xRecipient",
      amount: 0.08,
      token: "USDC",
      chain: "base",
    });

    assert.equal(tx.txHash, "0xtxhash_approved");
    assert.equal(tx.spendDecisionId, "dec_ok_1");
    assert.equal(daemon.settleRequests.length, 1);
    assert.equal(failures.length, 1);
    assert.deepEqual(
      {
        decisionId: failures[0].decisionId,
        provider: failures[0].provider,
        network: failures[0].network,
        asset: failures[0].asset,
        amount: failures[0].amount,
        credits: failures[0].credits,
        txHash: failures[0].txHash,
      },
      {
        decisionId: "dec_ok_1",
        provider: "orbserv",
        network: CHAIN_TO_CAIP2.base,
        asset: USDC_ADDRESS.base,
        amount: "80000",
        credits: "8",
        txHash: "0xtxhash_approved",
      }
    );
    assert.equal(orb.covenant.listFailedSettlements().length, 1);
  });

  test("automatic retry: retries settlement without rebroadcast or reauthorize", async () => {
    let settleCalls = 0;
    const originalSettle = daemon.settleResponse;
    daemon.server.removeAllListeners("request");
    daemon.server.on("request", async (req, res) => {
      const body = await readBody(req);
      if (req.method === "POST" && req.url === "/spend/authorize") {
        daemon.authorizeRequests.push({ headers: req.headers, body });
        res.writeHead(daemon.authorizeResponse.status, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify(daemon.authorizeResponse.body));
      }
      if (req.method === "POST" && req.url === "/spend/settle") {
        settleCalls++;
        daemon.settleRequests.push({ headers: req.headers, body });
        if (settleCalls < 2) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "transient" }));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ kind: "spend_settled" }));
      }
      res.writeHead(404).end();
    });

    const orb = makeOrb({
      perCallCap: "1000000",
      settlementRetryAttempts: 2,
      settlementRetryDelayMs: 0,
    });
    const wallet = await orb.wallet.get(WALLET_ID);

    const tx = await wallet.send({
      to: "0xRecipient",
      amount: 0.08,
      token: "USDC",
      chain: "base",
    });

    assert.equal(tx.txHash, "0xtxhash_approved");
    assert.equal(settleCalls, 2, "must retry settlement only");
    assert.equal(api.sendBodies.length, 1, "must not rebroadcast");
    assert.equal(daemon.authorizeRequests.length, 1, "must not reauthorize");
    assert.equal(orb.covenant.listFailedSettlements().length, 0);

    daemon.server.removeAllListeners("request");
    daemon.server.on("request", async (req, res) => {
      const body = await readBody(req);
      if (req.method === "POST" && req.url === "/spend/authorize") {
        daemon.authorizeRequests.push({ headers: req.headers, body });
        res.writeHead(daemon.authorizeResponse.status, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify(daemon.authorizeResponse.body));
      }
      if (req.method === "POST" && req.url === "/spend/settle") {
        daemon.settleRequests.push({ headers: req.headers, body });
        res.writeHead(daemon.settleResponse.status, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify(daemon.settleResponse.body));
      }
      res.writeHead(404).end();
    });
    daemon.settleResponse = originalSettle;
  });

  test("manual retry: failed settlement can be retried later without rebroadcast", async () => {
    daemon.settleResponse = { status: 500, body: { error: "settlement offline" } };
    const orb = makeOrb({ perCallCap: "1000000", settlementRetryAttempts: 0 });
    const wallet = await orb.wallet.get(WALLET_ID);

    const tx = await wallet.send({
      to: "0xRecipient",
      amount: 0.08,
      token: "USDC",
      chain: "base",
    });
    assert.equal(tx.txHash, "0xtxhash_approved");
    assert.equal(orb.covenant.listFailedSettlements().length, 1);

    const sendCountBefore = api.sendBodies.length;
    const authorizeCountBefore = daemon.authorizeRequests.length;
    const settleCountBefore = daemon.settleRequests.length;

    daemon.settleResponse = { status: 200, body: { kind: "spend_settled" } };
    const ok = await orb.covenant.retryLatestFailedSettlement();
    assert.equal(ok, true);
    assert.equal(orb.covenant.listFailedSettlements().length, 0);
    assert.equal(api.sendBodies.length, sendCountBefore, "no rebroadcast");
    assert.equal(
      daemon.authorizeRequests.length,
      authorizeCountBefore,
      "no reauthorize"
    );
    assert.equal(daemon.settleRequests.length, settleCountBefore + 1);
    assert.deepEqual(daemon.settleRequests.at(-1).body, {
      decision_id: "dec_ok_1",
      provider: "orbserv",
      network: CHAIN_TO_CAIP2.base,
      asset: USDC_ADDRESS.base,
      amount: "80000",
      credits: "8",
      tx_sig: "0xtxhash_approved",
    });
  });

  test("denied authorization never reaches broadcast or settlement", async () => {
    daemon.authorizeResponse = {
      status: 200,
      body: {
        kind: "spend.decision",
        approved: false,
        decision_id: "dec_deny_settle",
        reason: "denied",
      },
    };
    const orb = makeOrb({ perCallCap: "1000" });
    const wallet = await orb.wallet.get(WALLET_ID);

    await assert.rejects(
      wallet.send({ to: "0xR", amount: 5, token: "USDC", chain: "base" }),
      OrbSpendDeniedError
    );

    assert.equal(api.sendBodies.length, 0, "broadcast must not run");
    assert.equal(daemon.settleRequests.length, 0, "settlement must not run");
  });
});
