/**
 * AiVerifyHealthBadge — surfaces the AI link-verification heartbeat.
 *
 * Part C of the identity engine degrades SILENTLY to multi-signal rules when
 * the gateway fails, so the heartbeat is the only way to notice it is off.
 * Heartbeat rows are readable by platform admins only (RLS), so the badge is
 * rendered exclusively for them.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const SERVICE = "AI_VERIFY_LINK";

export function AiVerifyHealthBadge() {
  const { isPlatformAdmin } = usePlatformAdmin();

  const { data } = useQuery({
    queryKey: ["ai-verify-heartbeat"],
    enabled: isPlatformAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_heartbeat")
        .select("last_status, last_ok_at, last_error_at, last_message")
        .eq("service", SERVICE)
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  if (!isPlatformAdmin) return null;

  const ok = data?.last_status === "OK";
  const ts = ok ? data?.last_ok_at : data?.last_error_at;
  const stamp = ts ? format(new Date(ts), "d MMM HH:mm", { locale: es }) : "sin registro";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      <span>Verificación IA:</span>
      <Badge variant={ok ? "default" : data ? "destructive" : "secondary"}>
        {!data
          ? "sin datos"
          : ok
            ? `activa (última: ${stamp})`
            : `degradada (${data.last_message ?? "error"})`}
      </Badge>
    </div>
  );
}
