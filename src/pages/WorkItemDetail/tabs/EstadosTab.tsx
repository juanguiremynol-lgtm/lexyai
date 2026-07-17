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
import { useMemo } from "react";
import { EstadosTable, type EstadoRow } from "./EstadosTable";
import { toast } from "sonner";

interface EstadosTabProps {
  workItem: WorkItem;
}

// Row rendering handled by <EstadosTable/>.

/** Normalize titles for dedupe: strip .pdf / copy suffixes, drop anotación
 *  tail after " - "/" — ", strip accents, lowercase, collapse whitespace. */
function normalizeTitleForDedupe(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/\s*\(\d+\)\s*$/, "");
    s = s.replace(/\.pdf\s*$/i, "");
    if (s === before) break;
  }
  const sepIdx = (() => {
    const i1 = s.indexOf(" - ");
    const i2 = s.indexOf(" — ");
    if (i1 === -1) return i2;
    if (i2 === -1) return i1;
    return Math.min(i1, i2);
  })();
  if (sepIdx >= 0) s = s.slice(0, sepIdx);
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
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
        .select("id, title, source, fecha_fijacion, pdf_url, created_at, raw_data")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false);
      if (qErr) throw qErr;
      return data ?? [];
    },
    enabled: !!workItem.id,
    staleTime: 60 * 1000,
  });

  // Resolve the best openable URL for a local publicacion row. The
  // `pdf_url` column often stores a *storage path* (e.g.
  // "<pub_id>/<base64>.pdf") rather than a full URL — opening it directly
  // yields a 404 because the browser treats it as a relative link. Prefer,
  // in order:
  //   1. raw_data.raw_data.gcs_url         (public GCS URL from SAMAI)
  //   2. raw_data.pdf_url                  (samai-estados-api proxy URL)
  //   3. pdf_url if it starts with http    (legacy full URL)
  //   4. otherwise signal storage-bucket flow via `storage_path`
  const resolveLocalPubUrls = (p: any) => {
    const raw = (p?.raw_data ?? {}) as Record<string, any>;
    const nested = (raw?.raw_data ?? {}) as Record<string, any>;
    const gcsUrl = typeof nested?.gcs_url === "string" ? nested.gcs_url : null;
    const rawPdfUrl = typeof raw?.pdf_url === "string" ? raw.pdf_url : null;
    const rawUrlDescarga = typeof nested?.url_descarga === "string" ? nested.url_descarga : null;
    const stored = typeof p?.pdf_url === "string" ? p.pdf_url : null;
    const isFullUrl = stored && /^https?:\/\//i.test(stored);
    const directUrl = gcsUrl || rawPdfUrl || rawUrlDescarga || (isFullUrl ? stored : null);
    const storagePath = !isFullUrl && stored ? stored : null;
    return { directUrl, storagePath };
  };

  const openLocalPubAttachment = async (
    publicacionId: string,
    storagePath: string,
    fallbackUrl: string | null,
  ) => {
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("get-estado-attachment-url", {
        body: { publicacion_id: publicacionId, storage_path: storagePath },
      });
      if (!fnErr && data?.url) {
        window.open(data.url as string, "_blank", "noopener,noreferrer");
        return;
      }
      console.warn("[EstadosTab] get-estado-attachment-url failed", fnErr?.message, data);
    } catch (err) {
      console.warn("[EstadosTab] get-estado-attachment-url threw", err);
    }
    if (fallbackUrl) {
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      return;
    }
    toast.error("No se pudo abrir el PDF", {
      description: "El archivo no está disponible en este momento.",
    });
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
    // Step 2: canonical dedupe. Identity of an estado is
    // (radicado, normalized_name, despacho). Since this tab already scopes
    // to a single work_item (single radicado + single despacho), the key
    // collapses to normalized_name. Two rows are treated as the SAME
    // estado when their `fecha` values are within a 3 calendar-day window
    // of each other — this collapses twin rows produced by the two
    // ingestion passes (publication scrape vs document/PDF discovery),
    // which often differ by 0-2 days. The merged row keeps the EARLIEST
    // fecha and fills in whichever document link (auto/tabla/pdf) is
    // missing, never overwriting an existing non-null link with null.
    // With both channels emitting `fecha_providencia_iso`, duplicates now
    // carry identical dates. Tighten the window to ±2 days to match the
    // backend canonical rule while still tolerating rare skew from legacy
    // rows on the fallback path.
    const DAY_MS = 86_400_000;
    const WINDOW_DAYS = 2;
    const parseDay = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
    };
    // Document identity for the over-merge guard: prefer `hash_documento`
    // when the provider supplied it, otherwise fall back to the pathname of
    // whichever document URL is present. Returns null when no identity is
    // available — those rows keep the legacy name+window merge behavior.
    const docIdentity = (r: PpEstado): string | null => {
      const h = (r as any).hash_documento;
      if (typeof h === "string" && h.trim()) return `h:${h.trim()}`;
      const url = r.pdf_url || r.gcs_url_auto || r.gcs_url_tabla;
      if (typeof url === "string" && url.trim()) {
        try {
          const u = new URL(url);
          return `u:${u.pathname}`;
        } catch {
          return `u:${url}`;
        }
      }
      return null;
    };
    const groups = new Map<string, PpEstado[]>();
    for (const r of candidates) {
      const nt = normalizeTitleForDedupe(r.descripcion) || `__notitle__:${r.fuente}-${r.id}`;
      const arr = groups.get(nt) ?? [];
      arr.push(r);
      groups.set(nt, arr);
    }
    const mergeInto = (target: PpEstado, next: PpEstado): PpEstado => {
      const tDay = parseDay(target.fecha);
      const nDay = parseDay(next.fecha);
      // Keep earliest non-null fecha.
      let fecha = target.fecha;
      if (nDay !== null && (tDay === null || nDay < tDay)) fecha = next.fecha;
      return {
        ...target,
        fecha,
        gcs_url_auto: target.gcs_url_auto || next.gcs_url_auto || null,
        gcs_url_tabla: target.gcs_url_tabla || next.gcs_url_tabla || null,
        pdf_url: target.pdf_url || next.pdf_url || null,
        titulo_original: target.titulo_original || next.titulo_original || null,
        estado_numero: target.estado_numero || next.estado_numero || null,
      };
    };
    const out: PpEstado[] = [];
    for (const [, rows] of groups) {
      // Sort by fecha asc (nulls last) for deterministic clustering that
      // picks the earliest as the anchor.
      const sorted = [...rows].sort((a, b) => {
        const da = parseDay(a.fecha);
        const db = parseDay(b.fecha);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
      const clusters: PpEstado[] = [];
      for (const r of sorted) {
        const rDay = parseDay(r.fecha);
        const rIdent = docIdentity(r);
        // Find an existing cluster whose anchor date is within window,
        // OR (if r has no fecha) any cluster with the same normalized
        // name — nameless-date rows always fold in when possible.
        // Over-merge guard: when BOTH candidates carry a document
        // identity and the identities differ, do NOT merge — these are
        // genuinely distinct estados that happen to share a title and
        // date (e.g. three "Auto admite llamamiento en garantía" on the
        // same day, each with a different attachment).
        let absorbed = false;
        for (let i = 0; i < clusters.length; i++) {
          const cDay = parseDay(clusters[i].fecha);
          const within =
            rDay === null ||
            cDay === null ||
            Math.abs(rDay - cDay) <= WINDOW_DAYS;
          if (!within) continue;
          const cIdent = docIdentity(clusters[i]);
          if (rIdent && cIdent && rIdent !== cIdent) continue;
          clusters[i] = mergeInto(clusters[i], r);
          absorbed = true;
          break;
        }
        if (!absorbed) clusters.push({ ...r });
      }
      for (const c of clusters) out.push(c);
    }
    // Sort final list by fecha desc (nulls last) for display.
    out.sort((a, b) => {
      const da = parseDay(a.fecha);
      const db = parseDay(b.fecha);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
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
              <h3 className="font-semibold mb-1">Sin estados (publicaciones procesales) registrados aún</h3>
              <p className="text-sm text-muted-foreground">
                Los estados electrónicos del despacho (equivalente jurídico de las
                “publicaciones procesales” en CGP) aparecerán aquí en cuanto la
                jurisdicción los registre.
              </p>
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
              const { directUrl, storagePath } = resolveLocalPubUrls(src);
              if (directUrl) return undefined; // EstadosTable will open it directly
              if (storagePath) {
                return () => openLocalPubAttachment(localId, storagePath, null);
              }
              return undefined;
            })(),
          }))}
        />
      )}
    </div>
  );
}
