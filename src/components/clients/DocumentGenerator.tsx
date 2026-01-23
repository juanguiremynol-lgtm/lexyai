import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Copy, 
  Download, 
  Save, 
  AlertCircle, 
  CheckCircle2,
  FileDown,
  Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DocumentType,
  DOCUMENT_TEMPLATES,
  DOCUMENT_VARIABLES,
  DOCUMENT_TYPE_LABELS,
  DocumentVariable,
  formatDateLong,
  formatDateShort,
  generateReceiptCode,
  renderTemplate,
  extractMissingVariables,
} from "@/lib/document-templates";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";

interface Client {
  id: string;
  name: string;
  id_number: string | null;
  email: string | null;
}

interface Profile {
  firma_abogado_nombre_completo: string | null;
  firma_abogado_cc: string | null;
  firma_abogado_tp: string | null;
  firma_abogado_correo: string | null;
}

interface DocumentGeneratorProps {
  client: Client;
  onDocumentSaved?: () => void;
}

export function DocumentGenerator({ client, onDocumentSaved }: DocumentGeneratorProps) {
  const [documentType, setDocumentType] = useState<DocumentType>("PAZ_Y_SALVO");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch profile for lawyer signature
  const { data: profile } = useQuery({
    queryKey: ["profile-signature"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");
      
      const { data, error } = await supabase
        .from("profiles")
        .select("firma_abogado_nombre_completo, firma_abogado_cc, firma_abogado_tp, firma_abogado_correo")
        .eq("id", user.user.id)
        .single();
      
      if (error) throw error;
      return data as Profile;
    },
  });

  // Fetch client's contracts/services for servicios_bloque
  const { data: contracts } = useQuery({
    queryKey: ["client-contracts", client.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("service_description")
        .eq("client_id", client.id);
      
      if (error) throw error;
      return data;
    },
  });

  // Initialize variables when document type changes or data loads
  useEffect(() => {
    const now = new Date();
    const newVars: Record<string, string> = {};
    
    // Client data
    newVars.cliente_nombre_completo = client.name || "";
    newVars.cliente_numero_documento = client.id_number || "";
    newVars.cliente_correo = client.email || "";
    newVars.destinatario_trato = "Señor(a)";
    
    // Computed dates
    newVars.fecha_emision_larga = formatDateLong(now);
    newVars.pago_fecha_corta = formatDateShort(now);
    newVars.ciudad_emision = "Medellín";
    
    // Profile/Lawyer data
    if (profile) {
      newVars.firma_abogado_nombre_completo = profile.firma_abogado_nombre_completo || "JUAN GUILLERMO RESTREPO MAYA";
      newVars.firma_abogado_cc = profile.firma_abogado_cc || "1.017.133.290";
      newVars.firma_abogado_tp = profile.firma_abogado_tp || "226.135 C.S.J.";
      newVars.firma_abogado_correo = profile.firma_abogado_correo || "gr@lexetlit.com";
    } else {
      // Defaults if profile not loaded
      newVars.firma_abogado_nombre_completo = "JUAN GUILLERMO RESTREPO MAYA";
      newVars.firma_abogado_cc = "1.017.133.290";
      newVars.firma_abogado_tp = "226.135 C.S.J.";
      newVars.firma_abogado_correo = "gr@lexetlit.com";
    }
    
    // Services block from contracts
    if (contracts && contracts.length > 0) {
      const servicesList = contracts
        .map((c, i) => `${i + 1}. ${c.service_description}`)
        .join("\n");
      newVars.servicios_bloque = servicesList;
    } else {
      newVars.servicios_bloque = "";
    }
    
    // Receipt specific
    newVars.recibo_codigo = generateReceiptCode();
    newVars.pago_concepto = "";
    newVars.pago_valor_numero_formateado = "";
    newVars.pago_valor_letras_mayus = "";
    newVars.pago_total_numero_formateado = "";
    newVars.pago_total_letras_mayus = "";
    
    setVariables(newVars);
  }, [documentType, client, profile, contracts]);

  const currentVariables = DOCUMENT_VARIABLES[documentType];
  const template = DOCUMENT_TEMPLATES[documentType];
  const renderedDocument = useMemo(() => renderTemplate(template, variables), [template, variables]);
  const missingVars = useMemo(() => {
    const required = currentVariables.filter(v => v.required).map(v => v.key);
    return required.filter(key => !variables[key] || variables[key].trim() === "");
  }, [variables, currentVariables]);

  const handleVariableChange = (key: string, value: string) => {
    setVariables(prev => ({ ...prev, [key]: value }));
    
    // Sync total with value if total is empty
    if (key === "pago_valor_numero_formateado" && !variables.pago_total_numero_formateado) {
      setVariables(prev => ({ ...prev, pago_total_numero_formateado: value }));
    }
    if (key === "pago_valor_letras_mayus" && !variables.pago_total_letras_mayus) {
      setVariables(prev => ({ ...prev, pago_total_letras_mayus: value }));
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(renderedDocument);
      toast.success("Texto copiado al portapapeles");
    } catch {
      toast.error("Error al copiar");
    }
  };

  const handleExportDocx = async () => {
    setIsExporting(true);
    try {
      const paragraphs = renderedDocument.split("\n").map(line => 
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 200 },
        })
      );
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });
      
      const blob = await Packer.toBlob(doc);
      const fileName = `${DOCUMENT_TYPE_LABELS[documentType]}_${client.name.replace(/\s+/g, "_")}_${formatDateShort(new Date()).replace(/\//g, "-")}.docx`;
      saveAs(blob, fileName);
      toast.success("Documento DOCX descargado");
    } catch (error) {
      console.error("Error exporting DOCX:", error);
      toast.error("Error al exportar DOCX");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      // Use browser print functionality for secure PDF generation
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error("Por favor permita las ventanas emergentes para exportar PDF");
        setIsExporting(false);
        return;
      }
      
      const fileName = `${DOCUMENT_TYPE_LABELS[documentType]}_${client.name.replace(/\s+/g, "_")}_${formatDateShort(new Date()).replace(/\//g, "-")}`;
      
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${fileName}</title>
          <style>
            @page { 
              size: A4; 
              margin: 20mm; 
            }
            body { 
              font-family: Arial, sans-serif; 
              font-size: 12pt; 
              line-height: 1.6; 
              white-space: pre-wrap;
              padding: 0;
              margin: 0;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>${renderedDocument.replace(/\n/g, '<br>')}</body>
        </html>
      `);
      printWindow.document.close();
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        printWindow.print();
        // Close window after print dialog
        printWindow.onafterprint = () => printWindow.close();
      };
      
      toast.success("Ventana de impresión abierta - seleccione 'Guardar como PDF'");
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast.error("Error al exportar PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToHistory = async () => {
    if (missingVars.length > 0) {
      toast.error("Complete todas las variables obligatorias antes de guardar");
      return;
    }
    
    setIsSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");
      
      const { error } = await supabase.from("client_documents").insert({
        owner_id: user.user.id,
        client_id: client.id,
        document_type: documentType,
        document_content: renderedDocument,
        variables_snapshot: variables,
      });
      
      if (error) throw error;
      
      toast.success("Documento guardado en historial");
      onDocumentSaved?.();
    } catch (error) {
      console.error("Error saving document:", error);
      toast.error("Error al guardar documento");
    } finally {
      setIsSaving(false);
    }
  };

  const getVariablesByCategory = () => {
    const categories: Record<string, DocumentVariable[]> = {
      "Datos del Cliente": [],
      "Datos de Emisión": [],
      "Datos de Pago": [],
      "Servicios": [],
      "Firma del Abogado": [],
    };
    
    currentVariables.forEach(v => {
      if (v.key.startsWith("cliente_") || v.key === "destinatario_trato") {
        categories["Datos del Cliente"].push(v);
      } else if (v.key.startsWith("fecha_") || v.key === "ciudad_emision") {
        categories["Datos de Emisión"].push(v);
      } else if (v.key.startsWith("pago_") || v.key === "recibo_codigo") {
        categories["Datos de Pago"].push(v);
      } else if (v.key === "servicios_bloque") {
        categories["Servicios"].push(v);
      } else if (v.key.startsWith("firma_")) {
        categories["Firma del Abogado"].push(v);
      }
    });
    
    return Object.entries(categories).filter(([, vars]) => vars.length > 0);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Variables Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Generar Documento
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Document Type Selector */}
          <div className="space-y-2">
            <Label>Tipo de documento</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PAZ_Y_SALVO">Paz y Salvo</SelectItem>
                <SelectItem value="RECIBO_DE_PAGO">Recibo de Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Variables by category */}
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-6">
              {getVariablesByCategory().map(([category, vars]) => (
                <div key={category} className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">{category}</h4>
                  <div className="space-y-3">
                    {vars.map((variable) => (
                      <div key={variable.key} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm">{variable.label}</Label>
                          {variable.required && (
                            <Badge variant="outline" className="text-[10px] h-4">
                              Requerido
                            </Badge>
                          )}
                          {!variable.editable && (
                            <Badge variant="secondary" className="text-[10px] h-4">
                              Auto
                            </Badge>
                          )}
                        </div>
                        {variable.key === "servicios_bloque" ? (
                          <Textarea
                            value={variables[variable.key] || ""}
                            onChange={(e) => handleVariableChange(variable.key, e.target.value)}
                            placeholder="1. Servicio uno&#10;2. Servicio dos"
                            rows={4}
                            disabled={!variable.editable}
                          />
                        ) : (
                          <Input
                            value={variables[variable.key] || ""}
                            onChange={(e) => handleVariableChange(variable.key, e.target.value)}
                            disabled={!variable.editable}
                            className={!variable.editable ? "bg-muted" : ""}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Validation Status */}
          <div className="pt-4 border-t">
            {missingVars.length > 0 ? (
              <div className="flex items-start gap-2 text-amber-600 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  Faltan {missingVars.length} variable(s) obligatoria(s): {missingVars.slice(0, 3).join(", ")}
                  {missingVars.length > 3 && "..."}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Todas las variables completas</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Right: Preview and Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Vista Previa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScrollArea className="h-[400px] border rounded-md p-4 bg-muted/30">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
              {renderedDocument}
            </pre>
          </ScrollArea>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleCopyText} className="gap-2">
              <Copy className="h-4 w-4" />
              Copiar texto
            </Button>
            <Button 
              variant="outline" 
              onClick={handleExportDocx} 
              disabled={isExporting}
              className="gap-2"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              Exportar DOCX
            </Button>
            <Button 
              variant="outline" 
              onClick={handleExportPdf}
              disabled={isExporting}
              className="gap-2"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar PDF
            </Button>
            <Button 
              onClick={handleSaveToHistory}
              disabled={isSaving || missingVars.length > 0}
              className="gap-2"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar en historial
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
