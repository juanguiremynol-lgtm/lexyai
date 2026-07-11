/**
 * PublicacionesPpTab — CGP "Publicaciones Procesales" = the electronic
 * *estado* (state list) posted by the court. Legally this is the same
 * concept as the CPACA "Estados" tab (see EstadosTab), just sourced from
 * the Rama Judicial's Publicaciones Procesales portal.
 *
 * The list is the union of:
 *   1. Local DB (`work_item_publicaciones` where source='publicaciones'):
 *      canonical rows persisted by the sync worker, including proxy
 *      `pdf_url` and, once the attachment queue downloads them, a
 *      `storage_path` we can serve from our private bucket.
 *   2. Andromeda Read API (`/radicados/:radicado/actuaciones` filtered
 *      to fuente=PP): whatever the upstream feed currently exposes.
 *
 * Rows are merged by `(normalized title, fecha)` so the tab badge and the
 * rendered list can never diverge (the previous bug where the tab showed
 * "Publicaciones 2" but the panel was empty).
 */

import { useState } from "react";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Newspaper, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";
import { getActuacionesSummary, type WorkItemAct } from "./WorkItemActCard";
import { usePpActuaciones, resyncPpActuaciones } from "@/hooks/use-pp-actuaciones";
import { supabase } from "@/integrations/supabase/client";
import { EstadosTable, type EstadoRow } from "./EstadosTable";

interface Props {
  workItem: WorkItem;
}

function normalizeTitleKey(t: string | null | undefined): string {
  return (t || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function dateKey(d: string | null | undefined): string {
  return String(d || "").slice(0, 10);
}

function mergeKey(title: string | null | undefined, fecha: string | null | undefined): string {
  return `${normalizeTitleKey(title)}|${dateKey(fecha)}`;
}

/** Local `work_item_publicaciones` row joined with its downloaded attachment. */
interface LocalPub {
  id: string;
  title: string | null;
  source: string | null;
  fecha_fijacion: string | null;
  fecha_providencia: string | null;
  detected_at: string | null;
  pdf_url: string | null;
  raw_data: Record<string, unknown> | null;
  storage_path: string | null;
}

function mapLocalPubToAct(p: LocalPub): WorkItemAct {
  const raw = (p.raw_data || {}) as Record<string, unknown>;
  const fecha =
    p.fecha_fijacion ||
    p.fecha_providencia ||
    (typeof raw.fecha_publicacion === "string" ? (raw.fecha_publicacion as string) : null) ||
    (typeof raw.fecha === "string" ? (raw.fecha as string) : null) ||
    (p.detected_at ? p.detected_at.slice(0, 10) : null);

  // pdf_url on the row can be either a proxy URL (http[s]://…) or, on
  // older rows, a raw storage path. Keep both channels distinct.
  const rowPdfIsUrl = !!p.pdf_url && /^https?:\/\//i.test(p.pdf_url);
  const rawPdfUrl =
    (typeof raw.pdf_url === "string" ? (raw.pdf_url as string) : null) ||
    (rowPdfIsUrl ? p.pdf_url : null);

  return {
    id: `local-pub-${p.id}`,
    owner_id: "",
    work_item_id: "",
    description: p.title || "Sin descripción",
    event_summary: null,
    act_date: dateKey(fecha),
    act_date_raw: fecha,
    event_date: null,
    act_type: null,
    source: "pp",
    source_platform: "pp",
    source_url: null,
    source_reference: null,
    sources: ["pp"],
    despacho: null,
    workflow_type: null,
    scrape_date: null,
    hash_fingerprint: `local-pub-${p.id}`,
    created_at: p.detected_at || new Date().toISOString(),
    date_confidence: p.fecha_fijacion ? "high" : "low",
    raw_data: {
      ...raw,
      pdf_url: rawPdfUrl,
      storage_path: p.storage_path,
      __origin: "LOCAL_DB",
    },
    detected_at: p.detected_at,
    changed_at: null,
    instancia: null,
    fecha_registro_source: p.detected_at ? p.detected_at.slice(0, 10) : null,
    inicia_termino: null,
  };
}

/**
 * Opens a private storage PDF via the `get-estado-attachment-url` edge
 * function, which enforces org membership and signs the URL with the
 * service role. Direct client-side `createSignedUrl` cannot be used because
 * the `estado-attachments` bucket has no RLS SELECT policy for authenticated
 * users — every attempt returns "Object not found" regardless of whether the
 * object exists.
 *
 * If the edge function cannot produce a storage URL it falls back to
 * `proxyPdfUrl`, which for open portal hosts (ramajudicial.gov.co) works in
 * `window.open`.
 */
async function openStorageAttachment(
  publicacionId: string,
  storagePath: string,
  proxyPdfUrl?: string,
): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke("get-estado-attachment-url", {
      body: { publicacion_id: publicacionId, storage_path: storagePath },
    });
    if (!error && data?.url) {
      window.open(data.url as string, "_blank", "noopener,noreferrer");
      return;
    }
    console.warn("[openStorageAttachment] edge fn failed", error?.message, data);
  } catch (err) {
    console.warn("[openStorageAttachment] edge fn threw", err);
  }
  // UI-side fallback: open portal URL directly if it looks like an open host.
  if (proxyPdfUrl && /ramajudicial\.gov\.co/i.test(proxyPdfUrl)) {
    window.open(proxyPdfUrl, "_blank", "noopener,noreferrer");
    return;
  }
  toast.error("No se pudo abrir el PDF almacenado", {
    description: "El archivo no está disponible en este momento.",
  });
}

// PDF handling and provenance chips now live inline in the EstadosTable
// rows below (via row.onOpenFile and the row's fuente chip).

export function PublicacionesPpTab({ workItem }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const queryClient = useQueryClient();
  const radicado = workItem.radicado || null;

  const { data: apiActs, isLoading: apiLoading } = usePpActuaciones(radicado, !!radicado);

  // Local persisted publicaciones for this work item (source='publicaciones').
  // These rows are legally binding once inserted; they MUST appear in the
  // tab even when the upstream Read API returns nothing.
  const { data: localPubs, isLoading: localLoading } = useQuery({
    queryKey: ["work-item-publicaciones-local", "pp", workItem.id],
    queryFn: async (): Promise<LocalPub[]> => {
      const { data: pubs, error } = await supabase
        .from("work_item_publicaciones")
        .select("id, title, source, fecha_fijacion, fecha_providencia, detected_at, pdf_url, raw_data")
        .eq("work_item_id", workItem.id)
        .eq("source", "publicaciones")
        .eq("is_archived", false);
      if (error) throw error;
      const rows = (pubs ?? []) as Array<Omit<LocalPub, "storage_path">>;
      if (rows.length === 0) return [];

      // Enrich with storage_path from the attachment queue when available.
      const ids = rows.map((r) => r.id);
      const { data: attachments } = await supabase
        .from("estado_attachment_queue")
        .select("publicacion_id, storage_path, status")
        .in("publicacion_id", ids)
        .eq("status", "downloaded");
      const byPub = new Map<string, string>();
      for (const a of attachments ?? []) {
        if (a.publicacion_id && a.storage_path) byPub.set(a.publicacion_id, a.storage_path);
      }
      return rows.map((r) => ({ ...r, storage_path: byPub.get(r.id) ?? null }));
    },
    enabled: !!workItem.id,
    staleTime: 60 * 1000,
  });

  const isLoading = apiLoading || localLoading;

  // Merge API + local by (normalized title, fecha). API wins on collisions
  // (fresher raw fields), local fills in anything upstream is missing.
  const acts = useMemo<WorkItemAct[]>(() => {
    const merged: WorkItemAct[] = [];
    const seen = new Set<string>();
    for (const a of apiActs ?? []) {
      const k = mergeKey(a.description, a.act_date);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(a);
    }
    for (const p of localPubs ?? []) {
      const mapped = mapLocalPubToAct(p);
      const k = mergeKey(mapped.description, mapped.act_date);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(mapped);
    }
    merged.sort((a, b) => {
      const ad = a.act_date || "";
      const bd = b.act_date || "";
      if (ad && bd && ad !== bd) return bd.localeCompare(ad);
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return a.id.localeCompare(b.id);
    });
    return merged;
  }, [apiActs, localPubs]);

  const resyncMutation = useMutation({
    mutationFn: () => {
      if (!radicado) throw new Error("No radicado disponible");
      return resyncPpActuaciones(radicado);
    },
    onSuccess: () => {
      toast.success("Re-sincronización PP iniciada", {
        description: "Las publicaciones se actualizarán en unos momentos.",
        duration: 5000,
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["radicado-actuaciones", "PP", radicado] });
        queryClient.invalidateQueries({ queryKey: ["work-item-publicaciones-local", "pp", workItem.id] });
      }, 3000);
    },
    onError: (err) => {
      toast.error("Error al resincronizar PP", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    },
  });

  const filteredActs = acts?.filter((act) => {
    if (!searchTerm) return true;
    return (
      act.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      act.event_summary?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  if (!workItem.radicado) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="font-semibold mb-2">Sin radicado asignado</h3>
            <p className="text-muted-foreground text-sm">
              Agrega un radicado al asunto para consultar publicaciones procesales.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-l-4 border-l-muted bg-muted/20 p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-px w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-1/3 mt-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!acts || acts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <div className="text-4xl mb-4">📭</div>
            <h3 className="font-semibold mb-2">Sin estados (publicaciones procesales) registrados aún</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Los estados electrónicos del despacho (publicaciones procesales) aparecerán aquí
              en cuanto la Rama Judicial los registre en este proceso.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summary = getActuacionesSummary(acts);

  // Map merged WorkItemAct[] → EstadoRow[] for the Icarus-style table.
  const estadoRows: EstadoRow[] = (filteredActs ?? []).map((act) => {
    const raw = (act.raw_data ?? {}) as Record<string, unknown>;
    const storagePath = raw.storage_path as string | undefined;
    const proxyPdfUrl = raw.pdf_url as string | undefined;
    const pdfIndividualUrl = raw.pdf_individual_url as string | undefined;
    const rawTipo =
      (raw.tipo_publicacion as string | undefined) ||
      (raw.tipo_documento as string | undefined) ||
      (raw.tipoPublicacion as string | undefined) ||
      null;
    const onOpenFile = storagePath?.trim()
      ? () => {
          const pubId = String(act.id).replace(/^local-pub-/, "");
          openStorageAttachment(pubId, storagePath, proxyPdfUrl);
        }
      : undefined;
    return {
      key: act.id,
      fuente: "PP",
      title: act.description || "Sin descripción",
      despacho: act.despacho || workItem.authority_name || null,
      tipo_documento: rawTipo,
      fecha: act.act_date || act.act_date_raw || null,
      gcs_url_auto: (raw.gcs_url_auto as string | undefined) || null,
      gcs_url_tabla: (raw.gcs_url_tabla as string | undefined) || null,
      pdf_url: onOpenFile ? null : proxyPdfUrl || pdfIndividualUrl || null,
      onOpenFile,
    };
  });

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-foreground" />
              <h3 className="font-semibold text-foreground">Publicaciones Procesales</h3>
              <Badge variant="secondary">{summary.total}</Badge>
              <Badge variant="outline" className="text-xs">Estado electrónico</Badge>
            </div>
            <div className="flex items-center gap-2">
              {summary.newestDate && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  Más reciente: {new Date(summary.newestDate + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => resyncMutation.mutate()}
                disabled={resyncMutation.isPending}
                className="h-7 text-xs gap-1.5"
                title="Re-sincronizar publicaciones desde PP API"
              >
                <RefreshCw className={`h-3 w-3 ${resyncMutation.isPending ? 'animate-spin' : ''}`} />
                {resyncMutation.isPending ? "Sincronizando..." : "Re-sync"}
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 pt-1">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar publicaciones..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[200px] h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Filtered count */}
      {searchTerm && filteredActs && (
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredActs.length} de {acts.length} publicaciones
        </div>
      )}

      {/* Icarus-style dense table (Estados electrónicos) */}
      {estadoRows.length > 0 && <EstadosTable rows={estadoRows} />}

      {filteredActs?.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              No se encontraron publicaciones con los filtros aplicados.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
