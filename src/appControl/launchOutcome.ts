import { EventEmitter } from "node:events";

/**
 * Lets the control pipe learn how a `startGame` run ended, without threading callbacks
 * through the launch handler. Main process only.
 */
export interface GameLaunchOutcome {
  started: boolean;
  message?: string;
}

const events = new EventEmitter();
let inProgress = false;

export const isGameLaunchInProgress = () => inProgress;

/** Called by the startGame handler. Returns a function that reports the outcome once. */
export const beginGameLaunch = () => {
  inProgress = true;
  let settled = false;
  return (outcome: GameLaunchOutcome) => {
    if (settled) return;
    settled = true;
    inProgress = false;
    events.emit("outcome", outcome);
  };
};

/** Resolves with the next launch outcome. Register before triggering the launch. */
export const waitForGameLaunchOutcome = (timeoutMs: number) => {
  let cancel = () => undefined as void;
  const promise = new Promise<GameLaunchOutcome>((resolve) => {
    const onOutcome = (outcome: GameLaunchOutcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      events.off("outcome", onOutcome);
      resolve({ started: false, message: `No launch result within ${Math.round(timeoutMs / 1000)} seconds.` });
    }, timeoutMs);
    events.once("outcome", onOutcome);
    cancel = () => {
      clearTimeout(timer);
      events.off("outcome", onOutcome);
    };
  });
  return { promise, cancel };
};
