import type { Chain } from "../types.js";
import { CHAIN_TO_CAIP2 } from "./chain-assets.js";

/**
 * A single accepted payment option from an x402 `PaymentRequired` challenge.
 * Only the fields the spend-authorization gate needs are modelled; unknown
 * fields are ignored.
 */
interface PaymentRequirements {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
}

interface PaymentRequired {
  x402Version?: number;
  accepts?: PaymentRequirements[];
}

/** The spend details extracted from a parsed 402 challenge. */
export interface ParsedChallenge {
  /** CAIP-2 network the payment settles on. */
  network: string;
  /** Token contract (EVM) or mint (Solana). */
  asset: string;
  /** Atomic amount as a decimal string. */
  amount: string;
  /** Pay-to address, when the challenge declares one. */
  destination?: string;
}

const PAYMENT_REQUIRED_HEADERS = [
  "PAYMENT-REQUIRED",
  "payment-required",
  "X-Payment-Required",
  "x-payment-required",
];

function decodeBase64Json(value: string): unknown {
  // Node 18+ exposes Buffer; browsers expose atob. Prefer Buffer when present.
  const json =
    typeof Buffer !== "undefined"
      ? Buffer.from(value, "base64").toString("utf-8")
      : atob(value);
  return JSON.parse(json);
}

function readHeader(response: Response): string | null {
  for (const name of PAYMENT_REQUIRED_HEADERS) {
    const value = response.headers.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * Parse the x402 payment challenge from a 402 response. Tries the
 * `PAYMENT-REQUIRED` header first (x402 v2, base64-encoded JSON), falling back
 * to legacy header names, then to the response body JSON.
 *
 * @param response - The 402 response. Its body may be consumed.
 * @param preferredChain - When the challenge offers several options, prefer the
 *   one whose network matches this SDK chain.
 * @returns the {@link ParsedChallenge}, or `null` when no challenge is found.
 */
export async function parseX402Challenge(
  response: Response,
  preferredChain?: Chain
): Promise<ParsedChallenge | null> {
  let payload: PaymentRequired | null = null;

  const header = readHeader(response);
  if (header) {
    try {
      payload = decodeBase64Json(header) as PaymentRequired;
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    try {
      payload = (await response.clone().json()) as PaymentRequired;
    } catch {
      return null;
    }
  }

  const accepts = payload?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;

  const preferredNetwork = preferredChain
    ? CHAIN_TO_CAIP2[preferredChain]
    : undefined;
  const chosen =
    (preferredNetwork &&
      accepts.find((a) => a.network === preferredNetwork)) ||
    accepts[0];

  if (!chosen?.network || !chosen?.amount || !chosen?.asset) return null;

  return {
    network: chosen.network,
    asset: chosen.asset,
    amount: chosen.amount,
    destination: chosen.payTo,
  };
}
