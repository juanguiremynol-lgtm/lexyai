import { estadosDisplayInventory } from "@/lib/reconcile-estados";
import { openResolvedDocument } from "@/lib/open-document-window";
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
import { Scale, AlertTriangle, Newspaper, RefreshCw } from "lucide-react";
import type { WorkItem } from "@/types/work-item";
import { usePpEstados, type PpEstado } from "@/hooks/use-pp-estados";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useEffect } from "react";
import { downloadDocument } from '@/lib/download-document';
import { EstadosTable, type EstadoRow } from "./EstadosTable";
import { toast } from "sonner";
import { estadoDocumentStatus, type EstadoDocumentRecovery } from "@/lib/estado-document-status";
import {
  documentUrlCandidates,
  hasResolvableDocument,
  isDirectlyOpenable,
  openStoredDocument,
} from "@/lib/document-url-resolver";

interface EstadosTabProps {
  workItem: WorkItem;
  onCountChange?: (count: number) => void;
}

// Row rendering handled by <EstadosTable/>.

/** Normalize titles for dedupe: strip .pdf / copy suffixes, drop anotación
 *  tail after " - "/" — ", strip accents, lowercase, collapse whitespace. */

export function EstadosTab({ workItem, onCountChange }: EstadosTabProps) {
  const radicado = workItem.radicado || null;
  const { data: estados, isLoading, isFetching, error, refetch } = usePpEstados(radicado, !!radicado);

  // Also read local work_item_publicaciones so rows persisted from other
  // sources (e.g. Publicaciones Procesales legacy syncs) remain visible in
  // this tab even when the Andromeda Read API returns fewer rows. The
  // provider gating applies to WHICH providers we sync, NOT to WHICH rows
  // we display: any pub already stored for this work item is legally
  // relevant and must be surfaced.
  // "Never read" signal: no PP sync has ever completed for this work item.
  const { data: ppReadInfo } = useQuery({
    queryKey: ["work-item-pp-read-info", workItem.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("work_items")
        .select("pp_ultima_sync, pubs_initial_sync_completed_at")
        .eq("id", workItem.id)
        .maybeSingle();
      return data as { pp_ultima_sync: string | null; pubs_initial_sync_completed_at: string | null } | null;
    },
    staleTime: 60 * 1000,
  });
  const ppNeverRead = !!ppReadInfo && !ppReadInfo.pp_ultima_sync && !ppReadInfo.pubs_initial_sync_completed_at;

  const { data: localPubs } = useQuery({
    queryKey: ["work-item-publicaciones-local", workItem.id],
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("work_item_publicaciones")
        .select("id, title, source, fecha_fijacion, pdf_url, pdf_storage_path, pdf_available, created_at, raw_data")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false);
      if (qErr) throw qErr;
      return data ?? [];
    },
    enabled: !!workItem.id,
    staleTime: 60 * 1000,
  });

  const { data: recoveryDocuments } = useQuery({
    queryKey: ["estado-document-recovery", workItem.id],
    queryFn: async (): Promise<EstadoDocumentRecovery[]> => {
      const { data, error } = await supabase.from("estado_attachment_queue")
        .select("id,publicacion_id,filename,status,last_error,storage_path,validation_evidence")
        .eq("work_item_id", workItem.id);
      if (error) throw error;
      return (data ?? []) as unknown as EstadoDocumentRecovery[];
    },
    enabled: !!workItem.id,
    staleTime: 30_000,
  });

  const openVerifiedCopy = async (document: EstadoDocumentRecovery) => {
    const opened = await openResolvedDocument(async () => {
      const { data, error } = await supabase.functions.invoke("get-estado-attachment-url", {
        body: { publicacion_id: document.publicacion_id, storage_path: document.storage_path },
      });
      return !error && data?.source === "storage" && data?.url ? data.url : null;
    });
    if (!opened) toast.error("No se pudo abrir esta copia. La apertura no se completó y el archivo conserva su estado de recuperación.");
  };

  const downloadVerifiedCopy = async (document: EstadoDocumentRecovery) => {
    try {
      const { data, error } = await supabase.functions.invoke('get-estado-attachment-url', {
        body: { publicacion_id: document.publicacion_id, storage_path: document.storage_path },
      });
      if (error || !data?.url) throw new Error('unavailable');
      await downloadDocument(data.url, document.filename || 'documento.pdf');
    } catch { toast.error('No se pudo descargar la copia almacenada. Inténtalo de nuevo más tarde.'); }
  };

  // Resolve the best openable URL for a local publicacion row. The
  // `pdf_url` column often stores a *storage path* (e.g.
  // "<pub_id>/<base64>.pdf") rather than a full URL — opening it directly
  // yields a 404 because the browser treats it as a relative link. Prefer,
  // in order:
  //   1. raw_data.raw_data.gcs_url         (public GCS URL from SAMAI)
  //   2. raw_data.pdf_url                  (samai-estados-api proxy URL)
  //   3. pdf_url if it starts with http    (legacy full URL)
  //   4. otherwise signal storage-bucket flow via `storage_path`
  // Single resolver (see src/lib/document-url-resolver.ts). A stored row is
  // never turned into a link by string concatenation.
  const resolveLocalPubUrls = (p: any) => {
    const direct = documentUrlCandidates(p).find((u) => isDirectlyOpenable(u)) ?? null;
    return { directUrl: direct, resolvable: hasResolvableDocument(p) };
  };

  const openLocalPubAttachment = async (row: any) => {
    const ok = await openStoredDocument(row);
    if (!ok) {
      toast.error("No se pudo abrir el PDF", {
        description: "El archivo no está disponible en este momento.",
      });
    }
  };

  const mergedEstados = useMemo<PpEstado[]>(() => {
    const fromApi = Array.isArray(estados) ? estados : [];
    // Step 1: gather every candidate row from API + local DB.
    const candidates: PpEstado[] = [];
    for (const e of fromApi) candidates.push(e);
    for (const p of localPubs ?? []) {
      const { directUrl } = resolveLocalPubUrls(p);
      const rawAny = (p as any).raw_data ?? {};
      const nestedAny = (rawAny.raw_data ?? {}) as Record<string, any>;
      const hashDoc =
        (typeof nestedAny?.hash_documento === "string" && nestedAny.hash_documento) ||
        (typeof rawAny?.hash_documento === "string" && rawAny.hash_documento) ||
        null;
      candidates.push({
        fuente: (p.source || "PUBLICACIONES").toUpperCase(),
        id: `local-${p.id}`,
        fecha: (p.fecha_fijacion || "").toString() || null,
        descripcion: (p.title || "").trim() || "Sin descripción",
        gcs_url_auto: null,
        gcs_url_tabla: null,
        pdf_url: directUrl,
        titulo_original: null,
        estado_numero: null,
        hash_documento: hashDoc,
      });
    }
    // Persisted publications carry stable identities and document permissions.
    // The API is a fallback view, not a second set of the same publications.
    return estadosDisplayInventory(candidates);
  }, [estados, localPubs]);

  useEffect(() => { onCountChange?.(mergedEstados.length); }, [mergedEstados.length, onCountChange]);

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
                Estados electrónicos de la Rama Judicial (Publicaciones Procesales) y de la jurisdicción contencioso administrativa (CPACA).
                Los términos legales inician el día hábil siguiente a la fecha de desfijación.
                {' '}Se muestran las publicaciones incorporadas al proceso, con sus documentos asociados; la consulta externa es una alternativa cuando aún no hay publicaciones incorporadas.
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
              {ppNeverRead ? (
                <>
                  <h3 className="font-semibold mb-1">Estados: pendiente de lectura</h3>
                  <p className="text-sm text-muted-foreground">
                    Publicaciones Procesales todavía no ha revisado este radicado. Esto no
                    significa que no haya estados; aparecerán aquí cuando se complete la lectura.
                  </p>
                </>
              ) : (
              <>
              <h3 className="font-semibold mb-1">Sin estados (publicaciones procesales) registrados aún</h3>
              <p className="text-sm text-muted-foreground">
                Los estados electrónicos del despacho (equivalente jurídico de las
                “publicaciones procesales” en CGP) aparecerán aquí en cuanto la
                jurisdicción los registre.
              </p>
              </>
              )}
            </CardContent>
          </Card>
        )
      ) : (
        <EstadosTable
          rows={mergedEstados.map<EstadoRow>((estado) => ({
            key: `${estado.fuente}-${estado.id}`,
            fuente: estado.fuente,
            title:
              estado.titulo_original?.trim() ||
              estado.descripcion?.trim() ||
              "Sin descripción",
            // Surface the full body separately so the table can render it
            // under the title. When titulo_original is empty we already used
            // descripcion as the title — avoid duplicating it below.
            descripcion: estado.titulo_original?.trim()
              ? estado.descripcion || null
              : null,
            despacho: workItem.authority_name || null,
            tipo_documento: estado.estado_numero
              ? `Estado N° ${estado.estado_numero}`
              : null,
            fecha: estado.fecha || null,
            gcs_url_auto: estado.gcs_url_auto || null,
            gcs_url_tabla: estado.gcs_url_tabla || null,
            pdf_url: estado.pdf_url || null,
            onOpenFile: (() => {
              // For local-DB rows whose `pdf_url` column held a storage
              // path (no full URL and no raw_data direct URL), route
              // through the signed-URL edge function so the user is not
              // sent to a broken relative link.
              const idStr = String(estado.id);
              if (!idStr.startsWith("local-")) return undefined;
              const localId = idStr.slice("local-".length);
              const src = (localPubs ?? []).find((p: any) => p.id === localId);
              if (!src) return undefined;
              const { directUrl, resolvable } = resolveLocalPubUrls(src);
              if (directUrl) return undefined; // EstadosTable opens it directly
              if (resolvable) return () => openLocalPubAttachment(src);
              return undefined;
            })(),
          }))}
        />
      )}
      {!!recoveryDocuments?.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recuperación de documentos</CardTitle>
            <CardDescription>Estado de cada copia asociada a su publicación.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recoveryDocuments.map((document) => {
              const status = estadoDocumentStatus(document);
              const publication = localPubs?.find((pub) => pub.id === document.publicacion_id);
              return (
                <div key={document.id} className="rounded border p-3 text-sm">
                  <p className="font-medium">{publication?.title || "Publicación"} · {document.filename || "Documento"}</p>
                  <p><span className="font-medium">{status.label}.</span> {status.reason}</p>
                  {status.available && <div className="flex gap-3">
                    <Button variant="link" className="h-auto px-0" onClick={() => openVerifiedCopy(document)}>Abrir archivo almacenado</Button>
                    <Button variant="link" className="h-auto px-0" onClick={() => downloadVerifiedCopy(document)}>Descargar</Button>
                  </div>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
