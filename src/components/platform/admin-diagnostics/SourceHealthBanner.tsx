/**
 * SourceHealthBanner — ITERATION 46 (D1).
 *
 * SAMAI's scraping has been frozen since 27 July. Until now the app showed a
 * confident, up-to-date screen with nothing behind it, which is worse than
 * showing nothing: the lawyer reads silence as "no news".
 *
 * The banner states plainly WHICH source is stale, SINCE WHEN, and WHAT IT
 * MEANS — that absence of actuaciones proves nothing while the source is down.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const HEALTHY = new Set(["SUCCESS", "SUCCESS_EMPTY", "NOT_FOUND", "OK"]);

const SOURCE_LABEL: Record<string, string> = {
  samai: "SAMAI (expedientes CPACA)",
  samai_estados: "SAMAI Estados",
  cpnu: "CPNU (actuaciones)",
  publicaciones: "Publicaciones Procesales",
};

interface HealthRow {
  source: string;
  branch: string;
  status: string;
  last_success_at: string | null;
  observed_at: string | null;
}

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" }) : "fecha desconocida";

export function SourceHealthBanner({ branch }: { branch?: string }) {
  const { data } = useQuery({
    queryKey: ["upstream-source-health", branch ?? "ALL"],
    queryFn: async () => {
      let q = supabase
        .from("upstream_source_health" as never)
        .select("source, branch, status, last_success_at, observed_at");
      if (branch) q = q.in("branch", [branch, "ALL"]);
      const { data: rows } = await q;
      return (rows ?? []) as unknown as HealthRow[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const degraded = (data ?? []).filter((r) => !HEALTHY.has((r.status ?? "").toUpperCase()));
  if (degraded.length === 0) return null;

  return (
    <Alert variant="destructive" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Una fuente judicial no está leyendo</AlertTitle>
      <AlertDescription className="space-y-1 text-xs">
        {degraded.map((r) => (
          <p key={`${r.source}-${r.branch}`}>
            <strong>{SOURCE_LABEL[r.source] ?? r.source}</strong> no registra lecturas exitosas desde el{" "}
            {fmt(r.last_success_at)} (estado reportado: {r.status}).
          </p>
        ))}
        <p>
          Mientras la fuente esté detenida, <strong>la ausencia de actuaciones no prueba nada</strong>:
          no significa que no haya novedades, sino que no las estamos leyendo. No se pausa el monitoreo
          de ningún expediente por este silencio.
        </p>
      </AlertDescription>
    </Alert>
  );
}
