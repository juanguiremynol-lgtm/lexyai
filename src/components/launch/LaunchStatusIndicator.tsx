/**
 * LaunchStatusIndicator — Small badge for platform admin console.
 * Shows PRELAUNCH (orange) or LIVE (green).
 */
import { Badge } from "@/components/ui/badge";
import { Rocket, Clock } from "lucide-react";
import { useLaunchGate } from "@/hooks/use-launch-gate";

export function LaunchStatusIndicator() {
  const { isLive, secondsToLaunch } = useLaunchGate();

  if (isLive) {
    return (
      <Badge className="bg-green-500/15 text-green-600 border-green-500/30 gap-1">
        <Rocket className="h-3 w-3" />
        LIVE
      </Badge>
    );
  }

  const hours = Math.floor(secondsToLaunch / 3600);
  const timeLabel = hours > 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;

  return (
    <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 gap-1">
      <Clock className="h-3 w-3" />
      PRELAUNCH ({timeLabel})
    </Badge>
  );
}
