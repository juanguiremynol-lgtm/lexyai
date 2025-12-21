import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Search, FileText, ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { FILING_STATUSES, formatDateColombia } from "@/lib/constants";
import type { FilingStatus } from "@/types/database";

export default function Filings() {
  const [searchParams] = useSearchParams();
  const matterFilter = searchParams.get("matter");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: filings, isLoading } = useQuery({
    queryKey: ["filings", matterFilter],
    queryFn: async () => {
      let query = supabase
        .from("filings")
        .select(`
          *,
          matter:matters(id, client_name, matter_name)
        `)
        .order("updated_at", { ascending: false });

      if (matterFilter) {
        query = query.eq("matter_id", matterFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const filteredFilings = filings?.filter((f) => {
    const matter = f.matter as { client_name: string; matter_name: string } | null;
    const matchesSearch =
      (matter?.client_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (matter?.matter_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (f.radicado?.includes(search) ?? false);
    const matchesStatus = statusFilter === "all" || f.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getRelevantSla = (filing: typeof filings[0]) => {
    const status = filing.status as FilingStatus;
    if (['SENT_TO_REPARTO', 'RECEIPT_CONFIRMED'].includes(status)) {
      return { date: filing.sla_receipt_due_at, label: 'Recibo' };
    }
    if (['ACTA_PENDING'].includes(status)) {
      return { date: filing.sla_acta_due_at, label: 'Acta' };
    }
    if (['COURT_EMAIL_SENT', 'RADICADO_PENDING'].includes(status)) {
      return { date: filing.sla_court_reply_due_at, label: 'Juzgado' };
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Radicaciones</h1>
          <p className="text-muted-foreground">
            {matterFilter ? "Radicaciones del asunto seleccionado" : "Todas las radicaciones"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente, asunto o radicado..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(FILING_STATUSES).map(([key, { label }]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : filteredFilings?.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No hay radicaciones</h3>
              <p className="text-muted-foreground">
                Crea una nueva radicación desde el botón superior
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente / Asunto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Juzgado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFilings?.map((filing) => {
                  const matter = filing.matter as { client_name: string; matter_name: string } | null;
                  const sla = getRelevantSla(filing);
                  return (
                    <TableRow key={filing.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{matter?.client_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {matter?.matter_name}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{filing.filing_type}</TableCell>
                      <TableCell>
                        <StatusBadge status={filing.status as FilingStatus} />
                      </TableCell>
                      <TableCell>
                        {sla?.date ? (
                          <SlaBadge dueDate={sla.date} label={sla.label} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {filing.radicado ? (
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {filing.radicado}
                          </code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {filing.court_name || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/filings/${filing.id}`}>
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Ver Detalle
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
