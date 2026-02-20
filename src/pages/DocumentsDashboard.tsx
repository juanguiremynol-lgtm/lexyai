/**
 * Organization-wide Documents Dashboard
 * Route: /app/documentos-legales
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileSignature, FileText, Clock, CheckCircle2, AlertTriangle,
  Search, MoreHorizontal, ArrowRight, Loader2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground" },
  finalized: { label: "Finalizado", className: "bg-blue-500/15 text-blue-600" },
  sent_for_signature: { label: "Enviado", className: "bg-amber-500/15 text-amber-600" },
  signed: { label: "Firmado", className: "bg-green-500/15 text-green-600" },
  declined: { label: "Rechazado", className: "bg-destructive/15 text-destructive" },
  expired: { label: "Vencido", className: "bg-muted text-muted-foreground" },
  revoked: { label: "Revocado", className: "border-destructive text-destructive" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  poder_especial: "Poder Especial",
  contrato_servicios: "Contrato de Servicios",
};

function formatCOT(dateStr: string): string {
  try {
    return format(new Date(dateStr), "d MMM yyyy", { locale: es });
  } catch {
    return dateStr;
  }
}

export default function DocumentsDashboard() {
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ["org-documents", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, title, document_type, status, created_at, work_item_id, created_by")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  // Fetch signatures for latest signer info
  const docIds = documents?.map((d) => d.id) || [];
  const { data: signatures } = useQuery({
    queryKey: ["org-doc-signatures", docIds.join(",")],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data, error } = await supabase
        .from("document_signatures")
        .select("id, document_id, signer_name, signer_email, status, signed_at")
        .in("document_id", docIds);
      if (error) throw error;
      return data;
    },
    enabled: docIds.length > 0,
  });

  // Fetch work items for radicado display
  const workItemIds = [...new Set(documents?.map((d) => d.work_item_id).filter(Boolean) || [])];
  const { data: workItems } = useQuery({
    queryKey: ["doc-work-items", workItemIds.join(",")],
    queryFn: async () => {
      if (workItemIds.length === 0) return [];
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, title")
        .in("id", workItemIds as string[]);
      return data || [];
    },
    enabled: workItemIds.length > 0,
  });

  const sigsByDoc = useMemo(() => {
    const map = new Map<string, typeof signatures>();
    signatures?.forEach((s) => {
      const arr = map.get(s.document_id) || [];
      arr.push(s);
      map.set(s.document_id, arr);
    });
    return map;
  }, [signatures]);

  const wiMap = useMemo(() => {
    const map = new Map<string, { radicado: string | null; title: string | null }>();
    workItems?.forEach((w) => map.set(w.id, w));
    return map;
  }, [workItems]);

  // Stats
  const stats = useMemo(() => {
    if (!documents) return { total: 0, pending: 0, signedThisMonth: 0, expired: 0 };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      total: documents.length,
      pending: documents.filter((d) => d.status === "sent_for_signature").length,
      signedThisMonth: documents.filter((d) => d.status === "signed" && new Date(d.created_at) >= monthStart).length,
      expired: documents.filter((d) => d.status === "expired").length,
    };
  }, [documents]);

  // Filtered documents
  const filtered = useMemo(() => {
    if (!documents) return [];
    return documents.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (typeFilter !== "all" && d.document_type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const wi = d.work_item_id ? wiMap.get(d.work_item_id) : null;
        const sigs = sigsByDoc.get(d.id) || [];
        const matchTitle = d.title?.toLowerCase().includes(q);
        const matchRadicado = wi?.radicado?.toLowerCase().includes(q);
        const matchSigner = sigs.some(
          (s) => s.signer_name?.toLowerCase().includes(q) || s.signer_email?.toLowerCase().includes(q)
        );
        if (!matchTitle && !matchRadicado && !matchSigner) return false;
      }
      return true;
    });
  }, [documents, statusFilter, typeFilter, searchQuery, wiMap, sigsByDoc]);

  if (!orgId) return null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSignature className="h-6 w-6" /> Documentos Legales
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestión de documentos y firmas electrónicas de la organización
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary/60" />
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total documentos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-500/60" />
              <div>
                <p className="text-2xl font-bold">{stats.pending}</p>
                <p className="text-xs text-muted-foreground">Pendientes de firma</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500/60" />
              <div>
                <p className="text-2xl font-bold">{stats.signedThisMonth}</p>
                <p className="text-xs text-muted-foreground">Firmados este mes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-muted-foreground/60" />
              <div>
                <p className="text-2xl font-bold">{stats.expired}</p>
                <p className="text-xs text-muted-foreground">Vencidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, radicado o firmante..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Documents Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSignature className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {documents?.length === 0
                ? "Aún no hay documentos generados."
                : "No se encontraron documentos con los filtros seleccionados."}
            </p>
            {documents?.length === 0 && (
              <Button variant="outline" className="mt-4" onClick={() => navigate("/app/processes")}>
                Ir a expedientes <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-muted-foreground">Documento</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Expediente</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden lg:table-cell">Firmante</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                  <th className="text-left p-3 font-medium text-muted-foreground hidden md:table-cell">Creado</th>
                  <th className="w-10 p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => {
                  const sigs = sigsByDoc.get(doc.id) || [];
                  const firstSig = sigs[0];
                  const wi = doc.work_item_id ? wiMap.get(doc.work_item_id) : null;
                  const stCfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft;

                  return (
                    <tr
                      key={doc.id}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => {
                        if (doc.work_item_id) {
                          navigate(`/app/work-items/${doc.work_item_id}/documents/${doc.id}`);
                        }
                      }}
                    >
                      <td className="p-3">
                        <p className="font-medium truncate max-w-[250px]">{doc.title}</p>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                        </Badge>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        {wi ? (
                          <span className="text-xs font-mono text-muted-foreground">
                            {wi.radicado?.substring(0, 15) || wi.title?.substring(0, 20) || "—"}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        {firstSig ? (
                          <div>
                            <p className="text-xs font-medium">{firstSig.signer_name}</p>
                            <p className="text-xs text-muted-foreground">{firstSig.signer_email}</p>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${stCfg.className}`}>
                          {stCfg.label}
                        </Badge>
                      </td>
                      <td className="p-3 hidden md:table-cell text-xs text-muted-foreground">
                        {formatCOT(doc.created_at)}
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => doc.work_item_id && navigate(`/app/work-items/${doc.work_item_id}/documents/${doc.id}`)}
                            >
                              Ver detalles
                            </DropdownMenuItem>
                            {doc.work_item_id && (
                              <DropdownMenuItem onClick={() => navigate(`/app/work-items/${doc.work_item_id}`)}>
                                Ver expediente
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
