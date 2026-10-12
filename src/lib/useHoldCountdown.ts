import { useEffect, useState } from "react";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Counts down a hold window that restarts whenever `active` becomes true and
 * returns the remaining whole seconds (0 while inactive or once elapsed). The
 * startup announcement uses it to keep itself on screen for a few seconds
 * before the user may dismiss it.
 */
export function useHoldCountdown(active: boolean, holdMs: number): number {
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!active || holdMs <= 0) {
      setRemainingSeconds(0);
      return;
    }

    const deadline = Date.now() + holdMs;
    setRemainingSeconds(Math.ceil(holdMs / MILLISECONDS_PER_SECOND));
    const timer = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / MILLISECONDS_PER_SECOND),
      );
      setRemainingSeconds(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, MILLISECONDS_PER_SECOND);

    return () => window.clearInterval(timer);
  }, [active, holdMs]);

  return remainingSeconds;
}
