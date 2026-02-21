/**
 * PostClientCreationPrompt — Modal shown after creating a client,
 * offering to immediately generate a Contract using the client's data.
 *
 * Document types are derived from document-policy.ts, not hardcoded.
 *
 * Works in two contexts:
 *  A) Inside Work Item wizard → links client + navigates to doc wizard
 *  B) Standalone (Clients page) → lets user pick/create a Work Item first
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  FileText,
  ArrowRight,
  AlertTriangle,
  Briefcase,
} from "lucide-react";
import {
  getPostCreationDocOptions,
  type DocumentPolicyType,
  type PostCreationDocOption,
} from "@/lib/document-policy";

export interface PostClientCreationPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** If set, we're inside a Work Item context (entry point A) */
  workItemId?: string;
  /** Callback when user dismisses (entry point A: continue wizard) */
  onSkip?: () => void;
  /** Doc types disabled by org policy/plan */
  disabledDocTypes?: DocumentPolicyType[];
}

interface MissingField {
  label: string;
  link?: string;
}

export function PostClientCreationPrompt({
  open,
  onOpenChange,
  clientId,
  clientName,
  workItemId,
  onSkip,
  disabledDocTypes = [],
}: PostClientCreationPromptProps) {
  const navigate = useNavigate();
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string>("");
  const [showWorkItemPicker, setShowWorkItemPicker] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState<DocumentPolicyType | null>(null);

  const docOptions = getPostCreationDocOptions(disabledDocTypes);

  // Check client completeness for contract
  const { data: clientData } = useQuery({
    queryKey: ["client-contract-readiness", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("name, id_number, email, address")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open && !!clientId,
  });

  // Check lawyer profile completeness
  const { data: lawyerProfile } = useQuery({
    queryKey: ["lawyer-contract-readiness"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("firma_abogado_nombre_completo, firma_abogado_cc, firma_abogado_tp, firma_abogado_correo, professional_address, litigation_email")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch work items for standalone flow (entry point B)
  const { data: workItems } = useQuery({
    queryKey: ["work-items-for-contract-link"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select("id, title, radicado, workflow_type, demandantes")
        .is("deleted_at", null)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: open && !workItemId,
  });

  // Check for existing contract on the target work item
  const targetWiId = workItemId || selectedWorkItemId;
  const { data: existingContract } = useQuery({
    queryKey: ["existing-contract-check", targetWiId, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, status, created_at")
        .eq("work_item_id", targetWiId!)
        .eq("document_type", "contrato_servicios")
        .in("status", ["finalized", "ready_for_signature", "signed", "partially_signed", "sent_for_signature", "draft"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!targetWiId,
  });

  // Compute missing fields
  const missingFields: MissingField[] = [];
  if (clientData) {
    if (!clientData.name) missingFields.push({ label: "Nombre del cliente" });
    if (!clientData.id_number) missingFields.push({ label: "Cédula / NIT del cliente", link: `/app/clients/${clientId}` });
  }
  if (lawyerProfile) {
    if (!lawyerProfile.firma_abogado_nombre_completo) missingFields.push({ label: "Nombre completo del abogado", link: "/app/settings" });
    if (!lawyerProfile.firma_abogado_cc) missingFields.push({ label: "Cédula del abogado", link: "/app/settings" });
    if (!lawyerProfile.firma_abogado_tp) missingFields.push({ label: "Tarjeta Profesional", link: "/app/settings" });
    if (!lawyerProfile.firma_abogado_correo && !lawyerProfile.litigation_email) missingFields.push({ label: "Correo del abogado (litigio)", link: "/app/settings" });
  }
  const hasMissingFields = missingFields.length > 0;

  const handleGenerateDoc = (docType: DocumentPolicyType) => {
    const wiId = workItemId || selectedWorkItemId;
    if (!wiId) {
      // Need to pick a work item first (entry point B)
      setSelectedDocType(docType);
      setShowWorkItemPicker(true);
      return;
    }
    onOpenChange(false);
    navigate(`/app/work-items/${wiId}/documents/new?type=${docType}&from=client_creation`);
  };

  const handleOpenExisting = () => {
    if (!existingContract) return;
    const wiId = workItemId || selectedWorkItemId;
    onOpenChange(false);
    navigate(`/app/work-items/${wiId}/documents/${existingContract.id}`);
  };

  const handleSkip = () => {
    onOpenChange(false);
    onSkip?.();
  };

  const handleWorkItemSelected = () => {
    if (!selectedWorkItemId || !selectedDocType) return;
    onOpenChange(false);
    navigate(`/app/work-items/${selectedWorkItemId}/documents/new?type=${selectedDocType}&from=client_creation`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Cliente creado exitosamente
          </DialogTitle>
          <DialogDescription>
            <span className="block font-medium text-foreground">{clientName}</span>
            <span className="block text-xs mt-1">
              ¿Desea generar un documento ahora con los datos de este cliente?
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Missing fields warning */}
          {hasMissingFields && (
            <Alert variant="default" className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800">
                <p className="font-medium mb-1">Faltan datos para auto-completar el contrato:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {missingFields.map((f) => (
                    <li key={f.label}>
                      {f.link ? (
                        <button
                          onClick={() => { onOpenChange(false); navigate(f.link!); }}
                          className="text-primary underline hover:no-underline"
                        >
                          {f.label}
                        </button>
                      ) : f.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px]">
                  Puede continuar, pero deberá completar los campos manualmente en el wizard.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Existing contract warning */}
          {existingContract && (
            <Alert variant="default" className="border-blue-200 bg-blue-50">
              <FileText className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-xs text-blue-800">
                <p className="font-medium">Ya existe un contrato para este expediente.</p>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleOpenExisting}>
                    Abrir existente
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleGenerateDoc("contrato_servicios")}>
                    Generar nueva versión
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Work Item picker for standalone flow */}
          {!workItemId && showWorkItemPicker && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                Seleccione un expediente
              </div>
              {workItems && workItems.length > 0 ? (
                <>
                  <Select value={selectedWorkItemId} onValueChange={setSelectedWorkItemId}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Seleccionar expediente" />
                    </SelectTrigger>
                    <SelectContent>
                      {workItems.map((wi) => (
                        <SelectItem key={wi.id} value={wi.id}>
                          <span className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[9px] px-1">{wi.workflow_type}</Badge>
                            <span className="truncate max-w-[200px]">
                              {wi.title || wi.demandantes || wi.radicado || "Sin título"}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="w-full" disabled={!selectedWorkItemId} onClick={handleWorkItemSelected}>
                    <FileText className="h-4 w-4 mr-2" />
                    Generar {selectedDocType ? docOptions.find(o => o.docType === selectedDocType)?.label_es : "Documento"}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-2">
                  No hay expedientes activos. Cree uno primero para generar un documento.
                </p>
              )}
            </div>
          )}

          {/* Doc type options from policy */}
          {!showWorkItemPicker && !existingContract && docOptions.map((opt) => (
            <button
              key={opt.docType}
              onClick={() => handleGenerateDoc(opt.docType)}
              className="w-full text-left rounded-lg border border-border p-4 hover:border-primary/40 hover:bg-muted/30 transition-all group"
            >
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-sm group-hover:text-primary transition-colors">
                    Generar {opt.label_es}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description_es}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
              </div>
            </button>
          ))}

          {!showWorkItemPicker && !existingContract && docOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay tipos de documento disponibles para generar en este momento.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground">
            {workItemId ? "Continuar sin generar" : "No ahora"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
