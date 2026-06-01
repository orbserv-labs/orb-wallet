"use strict";
/**
 * @orbserv-labs/orb-wallet
 *
 * TypeScript SDK for the orbserv agent wallet API.
 *
 * @example
 * ```typescript
 * import { OrbWallet } from '@orbserv-labs/orb-wallet'
 *
 * const orb = new OrbWallet({ apiKey: process.env.ORB_API_KEY! })
 * const wallet = await orb.wallet.create({ name: "my-agent", chains: ["solana", "base"] })
 * ```
 *
 * @module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = exports.OrbAuthError = exports.OrbApiError = exports.OrbError = exports.X402Module = exports.PolicyModule = exports.AgentWallet = exports.WalletModule = exports.OrbWallet = void 0;
// Main client
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "OrbWallet", { enumerable: true, get: function () { return client_js_1.OrbWallet; } });
// Modules (useful for typing constructor params / DI)
var wallet_js_1 = require("./modules/wallet.js");
Object.defineProperty(exports, "WalletModule", { enumerable: true, get: function () { return wallet_js_1.WalletModule; } });
var agent_wallet_js_1 = require("./modules/agent-wallet.js");
Object.defineProperty(exports, "AgentWallet", { enumerable: true, get: function () { return agent_wallet_js_1.AgentWallet; } });
var policy_js_1 = require("./modules/policy.js");
Object.defineProperty(exports, "PolicyModule", { enumerable: true, get: function () { return policy_js_1.PolicyModule; } });
var x402_js_1 = require("./modules/x402.js");
Object.defineProperty(exports, "X402Module", { enumerable: true, get: function () { return x402_js_1.X402Module; } });
// Error classes
var errors_js_1 = require("./utils/errors.js");
Object.defineProperty(exports, "OrbError", { enumerable: true, get: function () { return errors_js_1.OrbError; } });
Object.defineProperty(exports, "OrbApiError", { enumerable: true, get: function () { return errors_js_1.OrbApiError; } });
Object.defineProperty(exports, "OrbAuthError", { enumerable: true, get: function () { return errors_js_1.OrbAuthError; } });
// HTTP client (exposed for advanced use, e.g. testing)
var http_js_1 = require("./utils/http.js");
Object.defineProperty(exports, "HttpClient", { enumerable: true, get: function () { return http_js_1.HttpClient; } });
