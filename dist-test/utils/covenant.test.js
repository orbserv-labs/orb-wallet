"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const covenant_js_1 = require("./covenant.js");
const http_js_1 = require("./http.js");
const errors_js_1 = require("./errors.js");
/** Replace global fetch with a URL-routed stub; returns recorded calls. */
function stubFetch(routes) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const body = init?.body ? JSON.parse(init.body) : undefined;
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
    });
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
(0, node_test_1.test)("authorize deny throws OrbSpendDeniedError with decision id and reason", async () => {
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
        const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
        await strict_1.default.rejects(client.authorize(AUTHORIZE_REQ), (err) => err instanceof errors_js_1.OrbSpendDeniedError &&
            err.decisionId === "dec-deny" &&
            err.reason === "over cap");
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("settleSpend resends the full authorization facts plus tx_sig", async () => {
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-1" },
        }),
        "/spend/settle": () => ({ status: 200, json: { kind: "spend_settled" } }),
    });
    try {
        const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
        const { decisionId } = await client.authorize(AUTHORIZE_REQ);
        await client.settleSpend(decisionId, "0xTxHash");
        const settleCall = fetchStub.calls.find((c) => c.url.endsWith("/spend/settle"));
        strict_1.default.ok(settleCall, "settle endpoint was called");
        strict_1.default.deepEqual(settleCall.body, {
            decision_id: "dec-1",
            provider: AUTHORIZE_REQ.provider,
            network: AUTHORIZE_REQ.network,
            asset: AUTHORIZE_REQ.asset,
            amount: AUTHORIZE_REQ.amount,
            credits: AUTHORIZE_REQ.credits,
            tx_sig: "0xTxHash",
        });
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("settleSpend evicts facts after a successful settle", async () => {
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-2" },
        }),
        "/spend/settle": () => ({ status: 200, json: { kind: "spend_settled" } }),
    });
    try {
        const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
        await client.authorize(AUTHORIZE_REQ);
        strict_1.default.ok(client.factsFor("dec-2"));
        await client.settleSpend("dec-2", "0xTxHash");
        strict_1.default.equal(client.factsFor("dec-2"), undefined);
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("settleSpend without cached facts throws OrbCovenantError", async () => {
    const fetchStub = stubFetch({});
    try {
        const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
        await strict_1.default.rejects(client.settleSpend("unknown-decision", "0xTxHash"), errors_js_1.OrbCovenantError);
        // Nothing should have been sent to the daemon.
        strict_1.default.equal(fetchStub.calls.length, 0);
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("settleSpend surfaces daemon errors and keeps the facts for retry", async () => {
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-3" },
        }),
        "/spend/settle": () => ({ status: 500, json: { error: "boom" } }),
    });
    try {
        const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
        await client.authorize(AUTHORIZE_REQ);
        await strict_1.default.rejects(client.settleSpend("dec-3", "0xTxHash"), errors_js_1.OrbCovenantError);
        // Facts survive a failed settle so it can be retried.
        strict_1.default.ok(client.factsFor("dec-3"));
    }
    finally {
        fetchStub.restore();
    }
});
function makeGate() {
    const client = new covenant_js_1.CovenantSpendAuthzClient(CONFIG);
    const gate = new covenant_js_1.SpendGate(client, new http_js_1.HttpClient("http://api.test", "key"));
    return { client, gate };
}
(0, node_test_1.test)("SpendGate.factsFor returns cached authorization facts", async () => {
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-gf" },
        }),
    });
    try {
        const { client, gate } = makeGate();
        await client.authorize(AUTHORIZE_REQ);
        strict_1.default.deepEqual(gate.factsFor("dec-gf"), AUTHORIZE_REQ);
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("retrySettle succeeds on second attempt when daemon fails once", async () => {
    let settleCalls = 0;
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-r1" },
        }),
        "/spend/settle": () => {
            settleCalls++;
            if (settleCalls === 1) {
                return { status: 500, json: { error: "transient" } };
            }
            return { status: 200, json: { kind: "spend_settled" } };
        },
    });
    try {
        const { client, gate } = makeGate();
        await client.authorize(AUTHORIZE_REQ);
        await gate.retrySettle("dec-r1", "0xTxHash", {
            maxAttempts: 3,
            delayMs: 0,
        });
        strict_1.default.equal(settleCalls, 2);
        strict_1.default.equal(client.factsFor("dec-r1"), undefined);
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("retrySettle throws after maxAttempts and keeps facts cached", async () => {
    const fetchStub = stubFetch({
        "/spend/authorize": () => ({
            status: 200,
            json: { kind: "spend_authorized", approved: true, decision_id: "dec-r2" },
        }),
        "/spend/settle": () => ({ status: 500, json: { error: "boom" } }),
    });
    try {
        const { client, gate } = makeGate();
        await client.authorize(AUTHORIZE_REQ);
        await strict_1.default.rejects(gate.retrySettle("dec-r2", "0xTxHash", { maxAttempts: 2, delayMs: 0 }), errors_js_1.OrbCovenantError);
        strict_1.default.ok(client.factsFor("dec-r2"));
        const settleCalls = fetchStub.calls.filter((c) => c.url.endsWith("/spend/settle"));
        strict_1.default.equal(settleCalls.length, 2);
    }
    finally {
        fetchStub.restore();
    }
});
