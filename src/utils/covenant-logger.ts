import type { CovenantSettlementContext } from "./covenant.js";

/** Structured fields logged when post-broadcast settlement fails. */
export interface CovenantSettlementFailureLog
  extends CovenantSettlementContext {
  txHash: string;
  error: unknown;
  attempts: number;
}

type SettlementFailureLogger = (log: CovenantSettlementFailureLog) => void;

let settlementFailureLogger: SettlementFailureLogger = (log) => {
  const { error, ...fields } = log;
  console.warn(
    "[orb-wallet:covenant] Failed to settle Covenant authorization",
    {
      ...fields,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : error,
    }
  );
};

/** Override the default settlement-failure logger (e.g. in tests or host apps). */
export function setCovenantSettlementLogger(
  logger: SettlementFailureLogger
): void {
  settlementFailureLogger = logger;
}

/** Reset to the built-in console.warn logger. */
export function resetCovenantSettlementLogger(): void {
  settlementFailureLogger = (log) => {
    const { error, ...fields } = log;
    console.warn(
      "[orb-wallet:covenant] Failed to settle Covenant authorization",
      {
        ...fields,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
      }
    );
  };
}

export function logSettlementFailure(
  log: CovenantSettlementFailureLog
): void {
  settlementFailureLogger(log);
}
