/**
 * SuggestedEmailLinksQueue — Bandeja de vínculos de confianza media
 * (0.5-0.7, típicamente matcher por PARTE). Sin esta cola los vínculos
 * sugeridos quedan invisibles y el matcher por parte no sirve de nada.
 *
 * Se puede usar global (sin `workItemId`) o dentro de la pestaña Correos de
 * un expediente.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X, ExternalLink, HelpCircle, FolderSymlink } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  useSuggestedEmailLinks,
  useApplySgdeAccessLink,
  useResolveEmailMessage,
  type SuggestedEmailLink,
} from "@/hooks/use-email-connection";

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

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const rows = (data ?? []).filter((r) => !workItemId || r.work_item_id === workItemId);

  // Una tarjeta por MENSAJE: un correo que matcheó varios expedientes es una
  // sola decisión del usuario, no N decisiones hermanas.
  const groups = new Map<string, SuggestedEmailLink[]>();
  for (const r of rows) {
    const key = r.internet_message_id ?? r.message_id ?? r.id;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  const messages = [...groups.values()];
  if (messages.length === 0 && hideWhenEmpty) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="h-4 w-4" aria-hidden />
          Vínculos por confirmar
          <Badge variant="secondary">{messages.length}</Badge>
        </CardTitle>
        <CardDescription>
          Correos que Andromeda cree relacionados con un expediente, pero sin certeza suficiente.
          Confirma o descarta para entrenar la cola.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay vínculos pendientes de confirmar.</p>
        ) : (
          messages.map((group) => {
            const link = group[0];
            // SGDE, Alfresco y TYBA comparten el mismo flujo de confirmación.
            const sgdeUrl = link.evidence_meta?.offer_access_link
              ? link.evidence_meta?.access_url ?? null
              : null;
            return (
            <div
              key={link.internet_message_id ?? link.message_id ?? link.id}
              className={`flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 ${
                link.low_content ? "py-2 opacity-80" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{link.subject ?? "(sin asunto)"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {link.direction === "sent" ? "Enviado" : "Recibido"}
                  {link.sender ? ` · ${link.sender}` : ""}
                  {link.received_at
                    ? ` · ${format(new Date(link.received_at), "d MMM yyyy", { locale: es })}`
                    : ""}
                </p>
                {!link.low_content && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.map((row) =>
                    group.length > 1 ? (
                      <Button
                        key={row.id}
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={resolve.isPending}
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
                </div>
                )}
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
                    disabled={resolve.isPending}
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
