/**
 * LaunchGatedDemo — The demo is NEVER gated.
 * It remains fully accessible pre-launch and post-launch as the primary conversion asset.
 * This wrapper exists for consistency but always renders the real DemoPage.
 */
import DemoPage from "@/pages/DemoPage";

export function LaunchGatedDemo() {
  return <DemoPage />;
}
