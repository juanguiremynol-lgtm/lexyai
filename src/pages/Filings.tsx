import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Search, FileText, ExternalLink, Trash2, Plus, Mail, Globe, Package } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { Badge } from "@/components/ui/badge";
import { UnifiedFilingCreator } from "@/components/filings/UnifiedFilingCreator";
import { FILING_STATUSES, formatDateColombia } from "@/lib/constants";
import type { FilingStatus } from "@/types/database";

const FILING_METHOD_ICONS = {
  EMAIL: Mail,
  PLATFORM: Globe,
  PHYSICAL: Package,
};

const FILING_METHOD_LABELS = {
  EMAIL: "Email",
  PLATFORM: "Plataforma",
  PHYSICAL: "Físico",
};

export default function Filings() {
  const [searchParams] = useSearchParams();
  const matterFilter = searchParams.get("matter");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const deleteFiling = useMutation({
    mutationFn: async (filingId: string) => {
      const { error } = await supabase
        .from("filings")
        .delete()
        .eq("id", filingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      toast.success("Radicación eliminada");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const { data: filings, isLoading } = useQuery({
    queryKey: ["filings", matterFilter],
    queryFn: async () => {
      let query = supabase
        .from("filings")
        .select(`
          *,
          matter:matters(id, client_name, matter_name),
          client:clients(id, name)
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
    const client = f.client as { name: string } | null;
    const matchesSearch =
      (matter?.client_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (matter?.matter_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (client?.name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (f.radicado?.includes(search) ?? false) ||
      (f.target_authority?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesStatus = statusFilter === "all" || f.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getRelevantSla = (filing: (typeof filings)[number]) => {
    const status = filing.status as FilingStatus;
    if (["SENT_TO_REPARTO", "RECEIPT_CONFIRMED"].includes(status)) {
      return { date: filing.sla_receipt_due_at, label: "Recibo" };
    }
    if (["ACTA_PENDING"].includes(status)) {
      return { date: filing.sla_acta_due_at, label: "Acta" };
    }
    if (["COURT_EMAIL_SENT", "RADICADO_PENDING"].includes(status)) {
      return { date: filing.sla_court_reply_due_at, label: "Juzgado" };
    }
    return null;
  };

  const getMethodIcon = (method: string | null) => {
    const Icon = FILING_METHOD_ICONS[method as keyof typeof FILING_METHOD_ICONS] || Mail;
    return <Icon className="h-3.5 w-3.5" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Radicaciones</h1>
          <p className="text-muted-foreground">
            {matterFilter
              ? "Radicaciones del asunto seleccionado"
              : "Gestiona las radicaciones desde su envío hasta el seguimiento del proceso"}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> + Radicado
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente, radicado, autoridad..."
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
                Crea una nueva radicación para comenzar el seguimiento
              </p>
              <Button onClick={() => setDialogOpen(true)} className="mt-4">
                <Plus className="mr-2 h-4 w-4" /> + Radicado
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Medio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Autoridad</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFilings?.map((filing) => {
                  const matter = filing.matter as {
                    client_name: string;
                    matter_name: string;
                  } | null;
                  const client = filing.client as { name: string } | null;
                  const sla = getRelevantSla(filing);
                  return (
                    <TableRow key={filing.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {client?.name || matter?.client_name}
                          </p>
                          {filing.sent_at && (
                            <p className="text-xs text-muted-foreground">
                              {formatDateColombia(filing.sent_at)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{filing.filing_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {getMethodIcon(filing.filing_method)}
                          <span className="text-sm text-muted-foreground">
                            {FILING_METHOD_LABELS[
                              filing.filing_method as keyof typeof FILING_METHOD_LABELS
                            ] || "—"}
                          </span>
                        </div>
                      </TableCell>
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
                          <span className="text-muted-foreground text-sm">
                            Pendiente
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm truncate max-w-[150px] block">
                          {filing.target_authority ||
                            filing.court_name || (
                              <span className="text-muted-foreground">—</span>
                            )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/filings/${filing.id}`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  ¿Eliminar radicación?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acción eliminará permanentemente esta
                                  radicación y todos sus documentos asociados.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteFiling.mutate(filing.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UnifiedFilingCreator
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["filings"] });
        }}
      />
    </div>
  );
}
