import { test } from "node:test";
import assert from "node:assert/strict";
import { CovenantSpendAuthzClient } from "./covenant.js";
import { OrbCovenantError, OrbSpendDeniedError } from "./errors.js";

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

const CONFIG = {
  gatewayUrl: "http://covenant.test:8421",
  token: "tok",
  perCallCap: "100000",
};

const AUTHORIZE_REQ = {
  provider: "orbserv",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "80000",
  per_call_cap: "100000",
  credits: 8,
  destination: "0xPayee",
};

test("authorize deny throws OrbSpendDeniedError with decision id and reason", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: {
        kind: "spend_authorized",
        approved: false,
        decision_id: "dec-deny",
        reason: "over cap",
      },
    }),
  });
  try {
    const client = new CovenantSpendAuthzClient(CONFIG);
    await assert.rejects(
      client.authorize(AUTHORIZE_REQ),
      (err: unknown) =>
        err instanceof OrbSpendDeniedError &&
        err.decisionId === "dec-deny" &&
        err.reason === "over cap"
    );
  } finally {
    fetchStub.restore();
  }
});

test("settleSpend resends the full authorization facts plus tx_sig", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-1" },
    }),
    "/spend/settle": () => ({ status: 200, json: { kind: "spend_settled" } }),
  });
  try {
    const client = new CovenantSpendAuthzClient(CONFIG);
    const { decisionId } = await client.authorize(AUTHORIZE_REQ);
    await client.settleSpend(decisionId, "0xTxHash");

    const settleCall = fetchStub.calls.find((c) =>
      c.url.endsWith("/spend/settle")
    );
    assert.ok(settleCall, "settle endpoint was called");
    assert.deepEqual(settleCall.body, {
      decision_id: "dec-1",
      provider: AUTHORIZE_REQ.provider,
      network: AUTHORIZE_REQ.network,
      asset: AUTHORIZE_REQ.asset,
      amount: AUTHORIZE_REQ.amount,
      credits: AUTHORIZE_REQ.credits,
      tx_sig: "0xTxHash",
    });
  } finally {
    fetchStub.restore();
  }
});

test("settleSpend evicts facts after a successful settle", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-2" },
    }),
    "/spend/settle": () => ({ status: 200, json: { kind: "spend_settled" } }),
  });
  try {
    const client = new CovenantSpendAuthzClient(CONFIG);
    await client.authorize(AUTHORIZE_REQ);
    assert.ok(client.factsFor("dec-2"));
    await client.settleSpend("dec-2", "0xTxHash");
    assert.equal(client.factsFor("dec-2"), undefined);
  } finally {
    fetchStub.restore();
  }
});

test("settleSpend without cached facts throws OrbCovenantError", async () => {
  const fetchStub = stubFetch({});
  try {
    const client = new CovenantSpendAuthzClient(CONFIG);
    await assert.rejects(
      client.settleSpend("unknown-decision", "0xTxHash"),
      OrbCovenantError
    );
    // Nothing should have been sent to the daemon.
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("settleSpend surfaces daemon errors and keeps the facts for retry", async () => {
  const fetchStub = stubFetch({
    "/spend/authorize": () => ({
      status: 200,
      json: { kind: "spend_authorized", approved: true, decision_id: "dec-3" },
    }),
    "/spend/settle": () => ({ status: 500, json: { error: "boom" } }),
  });
  try {
    const client = new CovenantSpendAuthzClient(CONFIG);
    await client.authorize(AUTHORIZE_REQ);
    await assert.rejects(
      client.settleSpend("dec-3", "0xTxHash"),
      OrbCovenantError
    );
    // Facts survive a failed settle so it can be retried.
    assert.ok(client.factsFor("dec-3"));
  } finally {
    fetchStub.restore();
  }
});
