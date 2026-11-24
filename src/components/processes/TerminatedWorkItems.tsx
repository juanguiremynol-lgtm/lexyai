import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { WorkflowType } from "@/lib/workflow-constants";
import { WorkflowTypeBadge } from "./WorkflowTypeBadge";

const PAGE_SIZE = 40;
const closedOn = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" });

export function TerminatedWorkItems() {
  const [page, setPage] = useState(0);
  const { data: user, isLoading: checkingUser, error: userError } = useQuery({
    queryKey: ["terminated-work-items", "viewer"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user;
    },
  });
  const records = useQuery({
    queryKey: ["terminated-work-items", user?.id, page],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const offset = page * PAGE_SIZE;
      const { data, error } = await supabase.from("work_item_tombstones")
        .select("id,radicado,titulo,workflow_type,deleted_at")
        .eq("owner_id", user!.id).eq("delete_reason", "USER_TERMINATED")
        .order("deleted_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = records.data?.slice(0, PAGE_SIZE) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Asuntos terminados</h1>
        <Button asChild variant="outline"><Link to="/app/processes">Ver asuntos activos</Link></Button>
      </div>
      {checkingUser || records.isLoading ? <p role="status">Cargando constancias…</p>
        : userError || records.isError || !user ? <p role="alert">No se pudieron cargar las constancias de término.</p>
        : rows.length === 0 ? <p className="text-muted-foreground">No hay constancias de término.</p>
        : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Asunto</TableHead>
                <TableHead>Radicado</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha de término</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>{row.titulo || (row.radicado ? "Expediente judicial" : row.id)}</TableCell>
                  <TableCell className="font-mono">{row.radicado || "—"}</TableCell>
                  <TableCell>{row.workflow_type ? <WorkflowTypeBadge workflowType={row.workflow_type as WorkflowType} /> : "—"}</TableCell>
                  <TableCell>{row.deleted_at ? closedOn.format(new Date(row.deleted_at)) : "—"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      {(page > 0 || (records.data?.length ?? 0) > PAGE_SIZE) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={page === 0 || records.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button>
          <Button type="button" variant="outline" disabled={(records.data?.length ?? 0) <= PAGE_SIZE} onClick={() => setPage(page + 1)}>Siguiente</Button>
        </div>
      )}
    </div>
  );
}
