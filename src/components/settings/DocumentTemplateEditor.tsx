/**
 * DocumentTemplateEditor — Edit the full text of a legal template.
 * Variables render as highlighted chips. Supports restore to defaults.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Save, RotateCcw, Eye, Loader2, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import {
  LegalDocumentType,
  LEGAL_TEMPLATES,
  LEGAL_DOCUMENT_TYPE_LABELS,
  renderLegalTemplate,
} from "@/lib/legal-document-templates";

interface DocumentTemplateEditorProps {
  templateType: LegalDocumentType;
}

const VARIABLE_INFO: Record<string, { label: string; example: string }> = {
  client_full_name: { label: "Nombre del poderdante", example: "Juan Carlos Pérez" },
  client_cedula: { label: "Cédula del poderdante", example: "1.234.567.890" },
  client_email: { label: "Correo del cliente", example: "juan@email.com" },
  client_address: { label: "Dirección del cliente", example: "Cra 43A #1-50" },
  lawyer_full_name: { label: "Nombre del apoderado", example: "Dra. María López" },
  lawyer_cedula: { label: "Cédula del apoderado", example: "9.876.543.210" },
  lawyer_tarjeta_profesional: { label: "Tarjeta profesional", example: "123.456" },
  radicado: { label: "Número de radicado", example: "05001-31-03-001-2024-00123" },
  court_name: { label: "Juzgado", example: "Juzgado 1 Civil del Circuito" },
  opposing_party: { label: "Contraparte", example: "Empresa XYZ S.A.S." },
  case_type: { label: "Tipo de proceso", example: "Civil" },
  case_description: { label: "Descripción del asunto", example: "Proceso ejecutivo" },
  city: { label: "Ciudad", example: "Medellín" },
  date: { label: "Fecha", example: "20 de febrero de 2026" },
  faculties: { label: "Facultades", example: "Presentar demandas..." },
  honorarios_amount: { label: "Valor honorarios", example: "5.000.000" },
  honorarios_type: { label: "Tipo honorarios", example: "Honorarios fijos" },
  honorarios_percentage: { label: "Porcentaje cuota litis", example: "20" },
  payment_schedule: { label: "Forma de pago", example: "50% al firmar..." },
  contract_duration: { label: "Duración", example: "hasta terminación del proceso" },
  firm_name: { label: "Nombre de la firma", example: "López & Asociados" },
  firm_nit: { label: "NIT de la firma", example: "901.123.456-7" },
  firm_address: { label: "Dirección de la firma", example: "Cra 43A #1-50" },
  firm_clause: { label: "(auto) Cláusula firma", example: "" },
  radicado_clause: { label: "(auto) Cláusula radicado", example: "" },
  honorarios_clause: { label: "(auto) Cláusula honorarios", example: "" },
};

export function DocumentTemplateEditor({ templateType }: DocumentTemplateEditorProps) {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const [htmlContent, setHtmlContent] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const systemTemplate = LEGAL_TEMPLATES[templateType];
  const templateLabel = LEGAL_DOCUMENT_TYPE_LABELS[templateType];

  // Find variables used in the template
  const templateVars = systemTemplate.variables.filter(v => v.source !== "computed");

  // Fetch custom template if exists
  const { data: customTemplate, isLoading } = useQuery({
    queryKey: ["custom-template", templateType, organization?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      let query = supabase
        .from("document_templates")
        .select("*")
        .eq("document_type", templateType)
        .eq("is_system_template", false);

      if (organization && isAdmin) {
        query = query.eq("organization_id", organization.id);
      } else {
        query = query.eq("customized_by", user.id);
      }

      const { data } = await query.maybeSingle();
      return data;
    },
  });

  // Initialize content
  useEffect(() => {
    if (!initialized) {
      if (customTemplate?.template_html) {
        setHtmlContent(customTemplate.template_html);
      } else {
        setHtmlContent(systemTemplate.html);
      }
      setInitialized(true);
    }
  }, [customTemplate, systemTemplate.html, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      if (customTemplate) {
        // Update existing
        const { error } = await supabase
          .from("document_templates")
          .update({ template_html: htmlContent, updated_at: new Date().toISOString() })
          .eq("id", customTemplate.id);
        if (error) throw error;
      } else {
        // Create new custom template
        const { error } = await supabase.from("document_templates").insert({
          document_type: templateType,
          name: `${templateLabel} (personalizado)`,
          display_name: `${templateLabel} (personalizado)`,
          template_html: htmlContent,
          template_body: { variables: systemTemplate.variables.map(v => v.key) },
          is_system_template: false,
          organization_id: (organization && isAdmin) ? organization.id : null,
          customized_by: user.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-template"] });
      toast.success("Plantilla guardada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  const handleRestore = async () => {
    if (customTemplate) {
      const { error } = await supabase
        .from("document_templates")
        .delete()
        .eq("id", customTemplate.id);
      if (error) {
        toast.error("Error: " + error.message);
        return;
      }
    }
    setHtmlContent(systemTemplate.html);
    queryClient.invalidateQueries({ queryKey: ["custom-template"] });
    toast.success("Plantilla restaurada al texto predeterminado");
  };

  const insertVariable = (key: string) => {
    setHtmlContent(prev => prev + `{{${key}}}`);
    toast.success(`Variable {{${key}}} insertada`);
  };

  // Build preview with sample data
  const previewHtml = (() => {
    const sampleVars: Record<string, string> = {};
    for (const [key, info] of Object.entries(VARIABLE_INFO)) {
      sampleVars[key] = info.example || `[${info.label}]`;
    }
    return renderLegalTemplate(htmlContent, sampleVars);
  })();

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Plantilla: {templateLabel}
          </CardTitle>
          <CardDescription>
            Personalice el texto de este documento. Los campos entre llaves {"{{ }}"} se llenarán automáticamente con los datos del expediente al generar el documento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Variables Panel */}
          <div className="bg-muted/50 border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium">Variables disponibles</p>
            <div className="flex flex-wrap gap-1.5">
              {templateVars.map(v => (
                <Badge
                  key={v.key}
                  variant="secondary"
                  className="cursor-pointer hover:bg-primary/20 transition-colors text-xs"
                  onClick={() => insertVariable(v.key)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {`{{${v.key}}}`} — {v.label}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Haga clic en una variable para insertarla al final del editor.</p>
          </div>

          {/* Template Editor */}
          <Textarea
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            className="font-mono text-xs min-h-[400px] leading-relaxed"
            placeholder="Escriba el HTML de la plantilla..."
          />

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar plantilla
            </Button>
            <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="h-4 w-4 mr-2" />
              {showPreview ? "Ocultar vista previa" : "Vista previa"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restaurar texto predeterminado
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Restaurar el texto original?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se perderán todas sus personalizaciones. Los documentos ya generados no se verán afectados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRestore}>Restaurar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Preview */}
          {showPreview && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Vista previa con datos de ejemplo</p>
                <ScrollArea className="max-h-[500px] border rounded-lg p-6 bg-white">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </ScrollArea>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
