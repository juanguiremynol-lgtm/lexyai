import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadRepartoPdf, formatIntakeDate, REPARTO_EVIDENCE_FIELDS } from "@/lib/judicial-reparto";
import { JudicialRepartoButton } from "./JudicialRepartoImport";

export function JudicialRepartoEvidence({ workItemId, ownerId, canImport }: {
  workItemId: string;
  ownerId: string;
  canImport: boolean;
}) {
  const evidence = useQuery({
    queryKey: ["judicial-reparto-evidence", workItemId, ownerId],
    retry: false,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user?.id !== ownerId) return null;
      const { data, error } = await supabase.from("judicial_reparto_imports").select(REPARTO_EVIDENCE_FIELDS)
        .eq("work_item_id", workItemId).order("confirmed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (evidence.isSuccess && evidence.data === null) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Radicación y reparto</CardTitle>
        {canImport && evidence.isSuccess && <JudicialRepartoButton existingWorkItemId={workItemId} size="sm" />}
      </CardHeader>
      <CardContent>
        {evidence.isPending && <p className="text-sm text-muted-foreground" role="status">Cargando comprobantes…</p>}
        {evidence.isError && <p className="text-sm text-destructive" role="alert">No se pudieron cargar los comprobantes.</p>}
        {evidence.isSuccess && !evidence.data?.length && <p className="text-sm text-muted-foreground">Aún no hay comprobantes vinculados.</p>}
        {!!evidence.data?.length && (
          <ul className="divide-y">
            {evidence.data.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {item.kind === "REPARTO" ? "Reparto" : "Constancia de recepción"}
                    {item.event_on ? " · " + formatIntakeDate(item.event_on) : ""}
                  </p>
                  {item.external_reference && <p className="break-words text-muted-foreground">Solicitud {item.external_reference}</p>}
                  {item.radicado && <p className="break-all font-mono text-xs text-muted-foreground">{item.radicado}</p>}
                  {item.authority_name && <p className="break-words text-muted-foreground">{item.authority_name}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.pdf_path && (
                    <Button variant="outline" size="sm" onClick={() => {
                      if (item.pdf_path) void downloadRepartoPdf(item.pdf_path, item.pdf_name).catch((error: Error) => toast.error(error.message));
                    }}>Descargar PDF</Button>
                  )}
                  {item.message_url && (
                    <Button asChild variant="outline" size="sm">
                      <a href={item.message_url} target="_blank" rel="noopener noreferrer">Ver correo</a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
