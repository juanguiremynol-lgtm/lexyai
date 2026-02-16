/**
 * React hook for launch gate state.
 * Updates every second during PRELAUNCH for countdown accuracy.
 */
import { useState, useEffect } from "react";
import { getLaunchState, type LaunchState } from "@/lib/launch-gate";

export function useLaunchGate(): LaunchState {
  const [state, setState] = useState(() => getLaunchState());

  useEffect(() => {
    // Only tick if pre-launch
    if (state.isLive) return;

    const interval = setInterval(() => {
      const next = getLaunchState();
      setState(next);
      if (next.isLive) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isLive]);

  return state;
}
