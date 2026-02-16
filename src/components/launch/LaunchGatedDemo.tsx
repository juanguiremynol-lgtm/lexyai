/**
 * LaunchGatedDemo — Wraps DemoPage with pre-launch gating.
 * During PRELAUNCH: shows countdown, does NOT call external APIs.
 */
import { useLaunchGate } from "@/hooks/use-launch-gate";
import DemoPage from "@/pages/DemoPage";
import { PrelaunchDemoPage } from "./PrelaunchDemoPage";

export function LaunchGatedDemo() {
  const { isLive } = useLaunchGate();

  if (!isLive) {
    return <PrelaunchDemoPage />;
  }

  return <DemoPage />;
}
