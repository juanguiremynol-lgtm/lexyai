/**
 * HearingTeamsNotice — Dashboard banner that shows when a hearing with a
 * videoconference link (Teams, Meet, Zoom, etc.) is scheduled for today.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Video, ExternalLink, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface TodayHearing {
  id: string;
  title: string;
  scheduled_at: string;
  teams_link: string;
  work_item_id: string | null;
  location: string | null;
  is_virtual: boolean;
}

function detectPlatformLabel(url: string): string {
  if (url.includes("teams.microsoft")) return "Unirse a Teams";
  if (url.includes("meet.google")) return "Unirse a Meet";
  if (url.includes("zoom.us") || url.includes("zoom.com")) return "Unirse a Zoom";
  return "Unirse a audiencia";
}

export function HearingTeamsNotice() {
  const { organization } = useOrganization();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data: todayHearings } = useQuery({
    queryKey: ["today-teams-hearings", organization?.id],
    queryFn: async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

      const { data, error } = await supabase
        .from("hearings")
        .select("id, title, scheduled_at, teams_link, work_item_id, location, is_virtual")
        .not("teams_link", "is", null)
        .gte("scheduled_at", todayStart)
        .lte("scheduled_at", todayEnd)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: true });

      if (error) throw error;
      return (data || []).filter((h: any) => h.teams_link && h.teams_link.trim() !== "") as TodayHearing[];
    },
    enabled: !!organization?.id,
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
    staleTime: 2 * 60 * 1000,
  });

  const visibleHearings = todayHearings?.filter((h) => !dismissed.has(h.id)) || [];

  if (visibleHearings.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleHearings.map((h) => {
        const scheduledTime = new Date(h.scheduled_at);
        const now = new Date();
        const diffMs = scheduledTime.getTime() - now.getTime();
        const diffMin = Math.round(diffMs / 60000);
        const isNow = diffMin <= 5 && diffMin >= -30; // within 5 min before to 30 min after
        const isPast = diffMin < -30;
        const timeStr = scheduledTime.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

        if (isPast) return null;

        return (
          <div
            key={h.id}
            className={cn(
              "relative flex items-center gap-4 rounded-lg border p-4 transition-all",
              isNow
                ? "bg-primary/10 border-primary animate-pulse"
                : "bg-accent/50 border-accent",
            )}
          >
            {/* Icon */}
            <div className={cn(
              "flex items-center justify-center h-10 w-10 rounded-full shrink-0",
              isNow ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}>
              <Video className="h-5 w-5" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm truncate">{h.title}</h3>
                {isNow && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground shrink-0">
                    ¡AHORA!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeStr}
                  {!isNow && diffMin > 0 && ` (en ${diffMin} min)`}
                </span>
              </div>
            </div>

            {/* Join button */}
            <Button
              size="sm"
              className={cn(
                "shrink-0 gap-1.5",
                isNow && "animate-none",
              )}
              asChild
            >
              <a href={h.teams_link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                {detectPlatformLabel(h.teams_link)}
              </a>
            </Button>

            {/* Dismiss */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setDismissed((prev) => new Set(prev).add(h.id))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
