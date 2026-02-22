/**
 * PlatformGenericSigningDocsPage — List of all generic PDF signing documents.
 * Shows status, signers, timestamps, and links to the document detail view.
 * Super Admin only.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileSignature, Search, Loader2, ArrowRight, Download,
  CheckCircle2, Clock, AlertTriangle, XCircle, PenTool, Package,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { EvidencePackButton } from "@/components/documents/EvidencePackButton";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-muted text-muted-foreground" },
  ready_for_signature: { label: "Contenido bloqueado", className: "bg-indigo-500/15 text-indigo-600" },
  partially_signed: { label: "Parcialmente firmado", className: "bg-orange-500/15 text-orange-600" },
  sent_for_signature: { label: "Enviado para firma", className: "bg-amber-500/15 text-amber-600" },
  signed_finalized: { label: "Firmado / Ejecutado", className: "bg-emerald-500/15 text-emerald-600" },
  signed: { label: "Firmado", className: "bg-green-500/15 text-green-600" },
  declined: { label: "Rechazado", className: "bg-destructive/15 text-destructive" },
  expired: { label: "Vencido", className: "bg-muted text-muted-foreground" },
  revoked: { label: "Revocado", className: "border-destructive text-destructive" },
  superseded: { label: "Reemplazado", className: "border-muted-foreground text-muted-foreground" },
};

function formatCOT(dateStr: string): string {
  try {
    return format(new Date(dateStr), "d MMM yyyy, h:mm a", { locale: es });
  } catch {
    return dateStr;
  }
}

export default function PlatformGenericSigningDocsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch generic signing documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ["generic-signing-docs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, title, document_type, status, created_at, created_by, organization_id, finalized_at, source_type, final_pdf_sha256")
        .eq("document_type", "generic_pdf_signing")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch signatures for all docs
  const docIds = documents?.map((d) => d.id) || [];
  const { data: signatures } = useQuery({
    queryKey: ["generic-signing-sigs", docIds.join(",")],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data, error } = await supabase
        .from("document_signatures")
        .select("id, document_id, signer_name, signer_email, signer_role, status, signed_at")
        .in("document_id", docIds);
      if (error) throw error;
      return data;
    },
    enabled: docIds.length > 0,
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

  // Stats
  const stats = useMemo(() => {
    if (!documents) return { total: 0, pending: 0, executed: 0, failed: 0 };
    return {
      total: documents.length,
      pending: documents.filter((d) => ["draft", "ready_for_signature", "partially_signed", "sent_for_signature"].includes(d.status)).length,
      executed: documents.filter((d) => d.status === "signed_finalized" || d.status === "signed").length,
      failed: documents.filter((d) => ["declined", "expired", "revoked"].includes(d.status)).length,
    };
  }, [documents]);

  // Filter
  const filtered = useMemo(() => {
    if (!documents) return [];
    return documents.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const sigs = sigsByDoc.get(d.id) || [];
        const matchTitle = d.title?.toLowerCase().includes(q);
        const matchSigner = sigs.some(
          (s) => s.signer_name?.toLowerCase().includes(q) || s.signer_email?.toLowerCase().includes(q)
        );
        if (!matchTitle && !matchSigner) return false;
      }
      return true;
    });
  }, [documents, statusFilter, searchQuery, sigsByDoc]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-cyan-400" />
            Documentos — Firma Genérica
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Todos los documentos PDF genéricos creados con la herramienta de firma.
          </p>
        </div>
        <Button
          onClick={() => navigate("/platform/generic-signing")}
          className="bg-cyan-600 hover:bg-cyan-700 gap-2"
        >
          <PenTool className="h-4 w-4" /> Nueva Firma
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <FileSignature className="h-8 w-8 text-cyan-400/60" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
                <p className="text-xs text-white/50">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-400/60" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.pending}</p>
                <p className="text-xs text-white/50">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-400/60" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.executed}</p>
                <p className="text-xs text-white/50">Ejecutados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-400/60" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.failed}</p>
                <p className="text-xs text-white/50">Fallidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            placeholder="Buscar por título o firmante..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-white/5 border-white/15 text-white placeholder:text-white/30"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-white/5 border-white/15 text-white">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-white/30" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="py-12 text-center">
            <FileSignature className="h-12 w-12 text-white/20 mx-auto mb-4" />
            <p className="text-white/50">
              {documents?.length === 0
                ? "Aún no hay documentos de firma genérica."
                : "No se encontraron documentos con los filtros seleccionados."}
            </p>
            {documents?.length === 0 && (
              <Button variant="outline" className="mt-4 border-white/15 text-white/60" onClick={() => navigate("/platform/generic-signing")}>
                Crear primera firma <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white/5 border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-3 font-medium text-white/50">Documento</th>
                  <th className="text-left p-3 font-medium text-white/50 hidden md:table-cell">Firmantes</th>
                  <th className="text-left p-3 font-medium text-white/50">Estado</th>
                  <th className="text-left p-3 font-medium text-white/50 hidden md:table-cell">Creado</th>
                  <th className="text-left p-3 font-medium text-white/50">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => {
                  const sigs = sigsByDoc.get(doc.id) || [];
                  const stCfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.draft;
                  const isExecuted = doc.status === "signed_finalized" || doc.status === "signed";
                  const lawyerSig = sigs.find(s => s.signer_role === "lawyer");
                  const clientSig = sigs.find(s => s.signer_role === "client");

                  return (
                    <tr
                      key={doc.id}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => navigate(`/app/documents/${doc.id}`)}
                    >
                      <td className="p-3">
                        <p className="font-medium text-white truncate max-w-[250px]">{doc.title}</p>
                        <p className="text-xs text-white/30 font-mono">{doc.id.substring(0, 8)}…</p>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <div className="space-y-1">
                          {lawyerSig && (
                            <div className="flex items-center gap-1.5">
                              {lawyerSig.status === "signed" ? (
                                <CheckCircle2 className="h-3 w-3 text-green-400" />
                              ) : (
                                <Clock className="h-3 w-3 text-amber-400" />
                              )}
                              <span className="text-xs text-white/70">{lawyerSig.signer_name}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20 text-white/40">Abogado</Badge>
                            </div>
                          )}
                          {clientSig && (
                            <div className="flex items-center gap-1.5">
                              {clientSig.status === "signed" ? (
                                <CheckCircle2 className="h-3 w-3 text-green-400" />
                              ) : clientSig.status === "declined" ? (
                                <XCircle className="h-3 w-3 text-red-400" />
                              ) : (
                                <Clock className="h-3 w-3 text-amber-400" />
                              )}
                              <span className="text-xs text-white/70">{clientSig.signer_name}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20 text-white/40">Cliente</Badge>
                            </div>
                          )}
                          {sigs.length === 0 && <span className="text-xs text-white/30">—</span>}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${stCfg.className}`}>
                          {stCfg.label}
                        </Badge>
                      </td>
                      <td className="p-3 hidden md:table-cell text-xs text-white/50">
                        {formatCOT(doc.created_at)}
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/app/documents/${doc.id}`)}
                            className="text-white/50 hover:text-white h-7 px-2"
                          >
                            Ver
                          </Button>
                          {isExecuted && (
                            <EvidencePackButton
                              documentId={doc.id}
                              documentTitle={doc.title}
                              variant="ghost"
                              size="sm"
                              className="text-white/50 hover:text-white h-7 px-2"
                            />
                          )}
                        </div>
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
