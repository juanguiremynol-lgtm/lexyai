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
import { Check, X, ExternalLink, HelpCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useSuggestedEmailLinks, useUpdateEmailLinkStatus } from "@/hooks/use-email-connection";

export function SuggestedEmailLinksQueue({
  workItemId,
  hideWhenEmpty = false,
}: {
  workItemId?: string;
  hideWhenEmpty?: boolean;
}) {
  const { data, isLoading } = useSuggestedEmailLinks();
  const update = useUpdateEmailLinkStatus();

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const rows = (data ?? []).filter((r) => !workItemId || r.work_item_id === workItemId);
  if (rows.length === 0 && hideWhenEmpty) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="h-4 w-4" aria-hidden />
          Vínculos por confirmar
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          Correos que Andromeda cree relacionados con un expediente, pero sin certeza suficiente.
          Confirma o descarta para entrenar la cola.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay vínculos pendientes de confirmar.</p>
        ) : (
          rows.map((link) => (
            <div
              key={link.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
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
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {link.work_items?.radicado ?? link.work_items?.title ?? "Expediente"}
                  </Badge>
                  <Badge variant="outline">
                    {link.matched_by} · {Math.round(Number(link.confidence) * 100)}%
                  </Badge>
                  {link.matched_value && <Badge variant="outline">{link.matched_value}</Badge>}
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
                <Button
                  size="sm"
                  onClick={() => update.mutate({ id: link.id, status: "CONFIRMED" })}
                  disabled={update.isPending}
                >
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ id: link.id, status: "DISMISSED" })}
                  disabled={update.isPending}
                >
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Descartar
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
