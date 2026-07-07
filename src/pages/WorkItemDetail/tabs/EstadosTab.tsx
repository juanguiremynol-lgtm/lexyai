/**
 * Estados Tab — Estados Procesales
 *
 * Source of truth: Andromeda Read API
 *   GET /radicados/:radicado/estados
 *
 * Returns rows from both fuente="PP" (Publicaciones Procesales / Rama
 * Judicial) and fuente="SAMAI_ESTADOS" (CPACA). Each row may carry up to
 * three document links: gcs_url_tabla, gcs_url_auto, pdf_url.
 *
 * Actuaciones (clerk registry) live in a separate tab and MUST NEVER appear
 * here.
 */

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Scale,
  ExternalLink,
  FileText,
  Table2,
  AlertTriangle,
  Newspaper,
  RefreshCw,
} from "lucide-react";
import type { WorkItem } from "@/types/work-item";
import { usePpEstados, type PpEstado } from "@/hooks/use-pp-estados";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

interface EstadosTabProps {
  workItem: WorkItem;
}

function fuenteLabel(fuente: string): { label: string; variant: "default" | "secondary" | "outline" | "info" } {
  const f = (fuente || "").toUpperCase();
  if (f === "PP" || f === "PUBLICACIONES") return { label: "Rama Judicial", variant: "info" };
  if (f === "SAMAI_ESTADOS" || f === "SAMAI") return { label: "Estados CPACA", variant: "secondary" };
  return { label: fuente || "Desconocido", variant: "outline" };
}

function formatFecha(fecha: string | null | undefined): string {
  const v = (fecha || "").trim();
  return v ? v : "Sin fecha";
}

function EstadoRow({ estado }: { estado: PpEstado }) {
  const { label, variant } = fuenteLabel(estado.fuente);
  const hasTabla = !!estado.gcs_url_tabla?.trim();
  const hasAuto = !!estado.gcs_url_auto?.trim();
  const hasPdf = !!estado.pdf_url?.trim();
  const hasAnyDoc = hasTabla || hasAuto || hasPdf;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={variant}>{label}</Badge>
          <Badge variant="outline" className="font-mono text-xs">{formatFecha(estado.fecha)}</Badge>
          {estado.estado_numero && (
            <Badge variant="secondary">Estado N° {estado.estado_numero}</Badge>
          )}
        </div>

        {estado.titulo_original && (
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {estado.titulo_original}
          </div>
        )}

        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {estado.descripcion?.trim() || "Sin descripción"}
        </p>

        {hasAnyDoc && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {hasTabla && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => window.open(estado.gcs_url_tabla!, "_blank", "noopener,noreferrer")}
              >
                <Table2 className="h-3.5 w-3.5" />
                Ver tabla del estado
              </Button>
            )}
            {hasAuto && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => window.open(estado.gcs_url_auto!, "_blank", "noopener,noreferrer")}
              >
                <FileText className="h-3.5 w-3.5" />
                Ver auto
              </Button>
            )}
            {hasPdf && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => window.open(estado.pdf_url!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver en Rama Judicial
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EstadosTab({ workItem }: EstadosTabProps) {
  const radicado = workItem.radicado || null;
  const { data: estados, isLoading, isFetching, error, refetch } = usePpEstados(radicado, !!radicado);

  // Also read local work_item_publicaciones so rows persisted from other
  // sources (e.g. Publicaciones Procesales legacy syncs) remain visible in
  // this tab even when the Andromeda Read API returns fewer rows. The
  // provider gating applies to WHICH providers we sync, NOT to WHICH rows
  // we display: any pub already stored for this work item is legally
  // relevant and must be surfaced.
  const { data: localPubs } = useQuery({
    queryKey: ["work-item-publicaciones-local", workItem.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("work_item_publicaciones")
        .select("id, title, source, fecha_fijacion, pdf_url, created_at")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false);
      if (qErr) throw qErr;
      return data ?? [];
    },
    enabled: !!workItem.id,
    staleTime: 60 * 1000,
  });

  const mergedEstados = useMemo<PpEstado[]>(() => {
    const fromApi = Array.isArray(estados) ? estados : [];
    const seen = new Set<string>();
    const out: PpEstado[] = [];
    for (const e of fromApi) {
      const key = `${(e.descripcion || "").trim().toLowerCase()}|${e.fecha || ""}`;
      seen.add(key);
      out.push(e);
    }
    for (const p of localPubs ?? []) {
      const desc = (p.title || "").trim();
      const fecha = (p.fecha_fijacion || "").toString();
      const key = `${desc.toLowerCase()}|${fecha}`;
      if (seen.has(key)) continue;
      out.push({
        fuente: (p.source || "PUBLICACIONES").toUpperCase(),
        id: `local-${p.id}`,
        fecha,
        descripcion: desc || "Sin descripción",
        gcs_url_auto: null,
        gcs_url_tabla: null,
        pdf_url: p.pdf_url || null,
        titulo_original: null,
        estado_numero: null,
      });
    }
    return out;
  }, [estados, localPubs]);

  if (!radicado) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Newspaper className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold mb-1">Sin radicado asignado</h3>
          <p className="text-sm text-muted-foreground">
            Agrega un radicado al asunto para consultar estados procesales.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Estados Procesales
                <Badge variant="secondary" className="ml-1">
                  {mergedEstados.length} registros
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
        Estados electrónicos de la Rama Judicial (Publicaciones Procesales) y de la
                jurisdicción contencioso administrativa (CPACA). Los términos legales inician el día hábil siguiente a la fecha de
                desfijación.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refrescar estados"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No se pudieron cargar los estados</AlertTitle>
          <AlertDescription className="font-mono text-xs break-all">
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : mergedEstados.length === 0 ? (
        !error && (
          <Card>
            <CardContent className="py-12 text-center">
              <Newspaper className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">Sin estados procesales</h3>
              <p className="text-sm text-muted-foreground">
                No hay estados procesales registrados todavía.
              </p>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {mergedEstados.map((estado) => (
            <EstadoRow key={`${estado.fuente}-${estado.id}`} estado={estado} />
          ))}
        </div>
      )}
    </div>
  );
}
