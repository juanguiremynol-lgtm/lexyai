/**
 * SuggestedEmailLinksQueue — Bandeja de vínculos de confianza media
 * (0.5-0.7, típicamente matcher por PARTE). Sin esta cola los vínculos
 * sugeridos quedan invisibles y el matcher por parte no sirve de nada.
 *
 * Triage (iteración 5.2): orden por fecha DESC, distintivo de remitente
 * judicial, filtros rápidos y descarte en bloque por MENSAJE. Confirmar sigue
 * siendo estrictamente por tarjeta y nada se aplica automáticamente.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  X,
  ExternalLink,
  HelpCircle,
  FolderSymlink,
  Scale,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useSuggestedEmailLinks,
  useApplySgdeAccessLink,
  useResolveEmailMessage,
  useBulkDismissEmailMessages,
  type SuggestedEmailLink,
} from "@/hooks/use-email-connection";

/** Dominios de la Rama Judicial y entidades con función jurisdiccional. */
const JUDICIAL_DOMAIN_RE =
  /(ramajudicial\.gov\.co|cendoj\.ramajudicial\.gov\.co|deaj\.ramajudicial\.gov\.co|consejodeestado\.gov\.co|corteconstitucional\.gov\.co|cortesuprema\.gov\.co|fiscalia\.gov\.co|procuraduria\.gov\.co|defensoria\.gov\.co)$/i;

function isJudicialSender(sender: string | null | undefined): boolean {
  const domain = (sender ?? "").split("@")[1]?.trim().toLowerCase();
  return Boolean(domain && JUDICIAL_DOMAIN_RE.test(domain));
}

/** Etiquetas en español de las señales de identidad (iteración 6). */
const SIGNAL_LABELS_ES: Record<string, string> = {
  RADICADO: "radicado",
  RADICADO_SIN_CERO: "radicado sin cero inicial",
  RADICADO_PARCIAL: "radicado parcial",
  PARTE_DEMANDANTE: "parte demandante",
  PARTE_DEMANDADA: "parte demandada",
  DESPACHO: "despacho",
  CLIENTE: "cliente",
};

/** Base de 21 dígitos: identidad del proceso (los 2 finales son la instancia). */
function radicadoBase(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 21);
}

function messageRadicados(link: SuggestedEmailLink): string[] {
  const raw = (link.evidence_meta as Record<string, unknown> | null)?.body_radicados;
  return Array.isArray(raw) ? raw.map((r) => String(r)).filter(Boolean) : [];
}

function matchSignals(link: SuggestedEmailLink): string[] {
  const raw = (link.evidence_meta as Record<string, unknown> | null)?.match_signals;
  return Array.isArray(raw) ? raw.map((r) => String(r)) : [];
}

/**
 * Conflicto de radicado: el correo nombra procesos y NINGUNO coincide con la
 * base del expediente candidato. Cinturón y tirantes — la regla dura del
 * matcher debería hacer esto inalcanzable.
 */
function hasRadicadoConflict(link: SuggestedEmailLink): boolean {
  const detected = messageRadicados(link);
  if (detected.length === 0) return false;
  const wiBase = radicadoBase(link.work_items?.radicado);
  if (!wiBase) return false;
  return !detected.some((d) => radicadoBase(d) === wiBase);
}

export function SuggestedEmailLinksQueue({
  workItemId,
  hideWhenEmpty = false,
}: {
  workItemId?: string;
  hideWhenEmpty?: boolean;
}) {
  const { data, isLoading } = useSuggestedEmailLinks();
  const resolve = useResolveEmailMessage();
  const applySgde = useApplySgdeAccessLink();
  const bulkDismiss = useBulkDismissEmailMessages();

  const [onlyJudicial, setOnlyJudicial] = useState(false);
  const [inactiveSince, setInactiveSince] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () => (data ?? []).filter((r) => !workItemId || r.work_item_id === workItemId),
    [data, workItemId],
  );

  // Una tarjeta por MENSAJE: un correo que matcheó varios expedientes es una
  // sola decisión del usuario, no N decisiones hermanas.
  const messages = useMemo(() => {
    const groups = new Map<string, SuggestedEmailLink[]>();
    for (const r of rows) {
      const key = r.internet_message_id ?? r.message_id ?? r.id;
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    return [...groups.values()].sort((a, b) => {
      const da = a[0].received_at ? new Date(a[0].received_at).getTime() : 0;
      const db = b[0].received_at ? new Date(b[0].received_at).getTime() : 0;
      return db - da;
    });
  }, [rows]);

  const visible = useMemo(
    () =>
      messages.filter((group) => {
        const link = group[0];
        if (onlyJudicial && !isJudicialSender(link.sender)) return false;
        if (inactiveSince) {
          const cutoff = new Date(`${inactiveSince}T23:59:59`).getTime();
          const received = link.received_at ? new Date(link.received_at).getTime() : 0;
          if (received > cutoff) return false;
        }
        return true;
      }),
    [messages, onlyJudicial, inactiveSince],
  );

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (messages.length === 0 && hideWhenEmpty) return null;

  const keyOf = (link: SuggestedEmailLink) =>
    link.internet_message_id ?? link.message_id ?? link.id;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((g) => selected.has(keyOf(g[0])));

  const dismissSelected = () => {
    const keys = visible
      .filter((g) => selected.has(keyOf(g[0])))
      .map((g) => ({
        internetMessageId: g[0].internet_message_id,
        messageId: g[0].message_id,
      }));
    if (keys.length === 0) return;
    bulkDismiss.mutate(keys, { onSuccess: () => setSelected(new Set()) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="h-4 w-4" aria-hidden />
          Vínculos por confirmar
          <Badge variant="secondary">{visible.length}</Badge>
        </CardTitle>
        <CardDescription>
          Correos que Andromeda cree relacionados con un expediente, pero sin certeza suficiente.
          Confirma o descarta para entrenar la cola.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="suggested-select-all"
                checked={allVisibleSelected}
                onCheckedChange={(v) =>
                  setSelected(v === true ? new Set(visible.map((g) => keyOf(g[0]))) : new Set())
                }
              />
              <Label htmlFor="suggested-select-all" className="text-xs">
                Seleccionar todo
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="suggested-only-judicial"
                checked={onlyJudicial}
                onCheckedChange={(v) => setOnlyJudicial(v === true)}
              />
              <Label htmlFor="suggested-only-judicial" className="text-xs">
                Solo remitente judicial
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="suggested-inactive-since" className="text-xs">
                Sin actividad desde
              </Label>
              <Input
                id="suggested-inactive-since"
                type="date"
                className="h-8 w-40"
                value={inactiveSince}
                onChange={(e) => setInactiveSince(e.target.value)}
              />
              {inactiveSince && (
                <Button size="sm" variant="ghost" onClick={() => setInactiveSince("")}>
                  Limpiar
                </Button>
              )}
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              disabled={selected.size === 0 || bulkDismiss.isPending}
              onClick={dismissSelected}
            >
              <X className="mr-1 h-3.5 w-3.5" aria-hidden />
              Descartar seleccionados ({selected.size})
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay vínculos pendientes de confirmar.</p>
        ) : (
          visible.map((group) => {
            const link = group[0];
            const cardKey = keyOf(link);
            const judicial = isJudicialSender(link.sender);
            // SGDE, Alfresco y TYBA comparten el mismo flujo de confirmación.
            const sgdeUrl = link.evidence_meta?.offer_access_link
              ? link.evidence_meta?.access_url ?? null
              : null;
            const conflicted = group.some(hasRadicadoConflict);
            const signals = matchSignals(link);
            const detectedRadicados = messageRadicados(link);
            const aiVerified = Boolean(
              (link.evidence_meta as Record<string, unknown> | null)?.ai_verified,
            );
            const aiReasons =
              ((link.evidence_meta as Record<string, unknown> | null)?.ai_reasons as
                | string[]
                | undefined) ?? [];
            return (
            <div
              key={cardKey}
              className={`flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 ${
                link.low_content ? "py-2 opacity-80" : ""
              }`}
            >
              <div className="flex min-w-0 gap-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(cardKey)}
                  onCheckedChange={() => toggle(cardKey)}
                  aria-label="Seleccionar correo"
                />
                <div className="min-w-0">
                <p className="truncate font-medium">{link.subject ?? "(sin asunto)"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {link.direction === "sent" ? "Enviado" : "Recibido"}
                  {link.sender ? ` · ${link.sender}` : ""}
                  {link.received_at
                    ? ` · ${format(new Date(link.received_at), "d MMM yyyy", { locale: es })}`
                    : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant={judicial ? "default" : "outline"}>
                    {judicial ? (
                      <>
                        <Scale className="mr-1 h-3 w-3" aria-hidden />
                        Remitente judicial
                      </>
                    ) : (
                      "Remitente no judicial"
                    )}
                  </Badge>
                  {signals.length > 0 && (
                    <Badge variant="secondary">
                      Coincide: {signals.map((s) => SIGNAL_LABELS_ES[s] ?? s.toLowerCase()).join(", ")}
                    </Badge>
                  )}
                  {aiVerified && (
                    <Badge variant="secondary" title={aiReasons.join(" · ")}>
                      <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                      Verificado por Andro IA
                    </Badge>
                  )}
                  {detectedRadicados.length > 0 && (
                    <Badge variant="outline">
                      Radicado en el correo: {detectedRadicados.slice(0, 2).join(", ")}
                    </Badge>
                  )}
                  {conflicted && (
                    <Badge variant="destructive">
                      <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
                      Radicado en conflicto
                    </Badge>
                  )}
                  {!link.low_content && (
                    <>
                      {group.map((row) =>
                        group.length > 1 ? (
                          <Button
                            key={row.id}
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            disabled={resolve.isPending || hasRadicadoConflict(row)}
                            onClick={() =>
                              resolve.mutate({
                                internetMessageId: link.internet_message_id,
                                messageId: link.message_id,
                                confirmLinkId: row.id,
                              })
                            }
                          >
                            <Check className="mr-1 h-3 w-3" aria-hidden />
                            {row.work_items?.radicado ?? row.work_items?.title ?? "Expediente"}
                          </Button>
                        ) : (
                          <Badge key={row.id} variant="outline">
                            {row.work_items?.radicado ?? row.work_items?.title ?? "Expediente"}
                          </Badge>
                        ),
                      )}
                      <Badge variant="outline">
                        {link.matched_by} · {Math.round(Number(link.confidence) * 100)}%
                      </Badge>
                      {link.matched_value && <Badge variant="outline">{link.matched_value}</Badge>}
                      {sgdeUrl && <Badge variant="secondary">Expediente electrónico</Badge>}
                    </>
                  )}
                </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {link.web_link && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={link.web_link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Ver
                    </a>
                  </Button>
                )}
                {sgdeUrl && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      applySgde.mutate({
                        linkId: link.id,
                        workItemId: link.work_item_id,
                        accessUrl: sgdeUrl,
                      })
                    }
                    disabled={applySgde.isPending}
                  >
                    <FolderSymlink className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Usar como enlace de acceso al expediente
                  </Button>
                )}
                {group.length === 1 && (
                  <Button
                    size="sm"
                    onClick={() =>
                      resolve.mutate({
                        internetMessageId: link.internet_message_id,
                        messageId: link.message_id,
                        confirmLinkId: link.id,
                      })
                    }
                    disabled={resolve.isPending || conflicted}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Confirmar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    resolve.mutate({
                      internetMessageId: link.internet_message_id,
                      messageId: link.message_id,
                    })
                  }
                  disabled={resolve.isPending}
                >
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Descartar
                </Button>
              </div>
            </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
