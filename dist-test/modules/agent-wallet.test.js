"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const agent_wallet_js_1 = require("./agent-wallet.js");
const http_js_1 = require("../utils/http.js");
const covenant_js_1 = require("../utils/covenant.js");
const errors_js_1 = require("../utils/errors.js");
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
/** Capture console.warn calls; returns the recorded arguments. */
function spyWarn() {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => {
        warnings.push(args);
    };
    return { warnings, restore: () => (console.warn = original) };
}
const WALLET_DATA = {
    id: "w1",
    name: "test-wallet",
    createdAt: "2026-01-01T00:00:00Z",
    status: "active",
    policy: {},
    evm: { address: "0xWallet", chain: "base" },
};
function makeWallet() {
    const http = new http_js_1.HttpClient("http://api.test", "orb_key");
    const gate = new covenant_js_1.SpendGate(new covenant_js_1.CovenantSpendAuthzClient({
        gatewayUrl: "http://covenant.test:8421",
        token: "tok",
        perCallCap: "100000",
    }), http);
    return new agent_wallet_js_1.AgentWallet(WALLET_DATA, http, gate);
}
const SEND_OPTIONS = {
    to: "0xPayee",
    amount: 0.08,
    token: "USDC",
    chain: "base",
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
(0, node_test_1.test)("denied authorization throws OrbSpendDeniedError and never broadcasts", async () => {
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
        await strict_1.default.rejects(wallet.send(SEND_OPTIONS), errors_js_1.OrbSpendDeniedError);
        const broadcastCalls = fetchStub.calls.filter((c) => c.url.includes("/wallets/w1/send"));
        strict_1.default.equal(broadcastCalls.length, 0, "broadcast must never be reached");
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("approved spend broadcasts then settles with the full payload", async () => {
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
        strict_1.default.equal(tx.txHash, "0xBroadcastHash");
        const settleCalls = fetchStub.calls.filter((c) => c.url.endsWith("/spend/settle"));
        strict_1.default.equal(settleCalls.length, 1, "settle called exactly once");
        const authorizeCall = fetchStub.calls.find((c) => c.url.endsWith("/spend/authorize"));
        const authorizeBody = authorizeCall.body;
        strict_1.default.deepEqual(settleCalls[0].body, {
            decision_id: "dec-ok",
            provider: authorizeBody.provider,
            network: authorizeBody.network,
            asset: authorizeBody.asset,
            amount: authorizeBody.amount,
            credits: authorizeBody.credits,
            tx_sig: "0xBroadcastHash",
        });
    }
    finally {
        fetchStub.restore();
    }
});
(0, node_test_1.test)("settlement failure is logged and never affects the tx result", async () => {
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
        strict_1.default.equal(tx.txHash, "0xBroadcastHash");
        strict_1.default.equal(tx.status, "confirmed");
        // The failure is observable with the facts needed for a later retry.
        strict_1.default.equal(warnSpy.warnings.length, 1);
        const [message, context] = warnSpy.warnings[0];
        strict_1.default.match(message, /Failed to settle Covenant authorization/);
        strict_1.default.equal(context.decisionId, "dec-sf");
        strict_1.default.equal(context.txHash, "0xBroadcastHash");
        strict_1.default.equal(context.amount, "80000");
        strict_1.default.equal(context.credits, 8);
        strict_1.default.equal(context.network, "eip155:8453");
    }
    finally {
        warnSpy.restore();
        fetchStub.restore();
    }
});
(0, node_test_1.test)("pending transaction without a hash skips settlement with a warning", async () => {
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
        strict_1.default.equal(tx.status, "pending");
        const settleCalls = fetchStub.calls.filter((c) => c.url.endsWith("/spend/settle"));
        strict_1.default.equal(settleCalls.length, 0, "no settle without a tx hash");
        strict_1.default.equal(warnSpy.warnings.length, 1);
    }
    finally {
        warnSpy.restore();
        fetchStub.restore();
    }
});
