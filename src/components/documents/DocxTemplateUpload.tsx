/**
 * DocxTemplateUpload — Upload, validate, and manage custom DOCX templates.
 * Shows placeholder help panel, validation results, and activation controls.
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Upload, FileText, CheckCircle2, AlertCircle, AlertTriangle,
  Loader2, Copy, Check, Trash2, ChevronDown, HelpCircle, Info,
  Shield, ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import {
  getDocTypeSchema,
  type DocTypeSchema,
} from "@/lib/docx-template-schema";
import {
  parseDocxTemplate,
  validateTokensAgainstSchema,
  computeSha256,
  type ValidationResult,
} from "@/lib/docx-template-parser";
import {
  LegalDocumentType,
  LEGAL_DOCUMENT_TYPE_LABELS,
} from "@/lib/legal-document-templates";

interface DocxTemplateUploadProps {
  documentType: LegalDocumentType;
}

export function DocxTemplateUpload({ documentType }: DocxTemplateUploadProps) {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const schema = getDocTypeSchema(documentType);
  const templateLabel = LEGAL_DOCUMENT_TYPE_LABELS[documentType];

  // Fetch existing templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ["custom-docx-templates", documentType, organization?.id],
    queryFn: async () => {
      const query = supabase
        .from("custom_docx_templates" as any)
        .select("*")
        .eq("document_type", documentType)
        .order("version", { ascending: false });

      if (organization) {
        (query as any).eq("organization_id", organization.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const activeTemplate = templates?.find((t: any) => t.is_active);

  // Upload handler
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".docx")) {
      toast.error("Solo se permiten archivos .docx");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10 MB");
      return;
    }

    setUploading(true);
    setValidationResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await computeSha256(buffer);

      // Parse and validate
      const { tokens } = await parseDocxTemplate(buffer);
      const result = validateTokensAgainstSchema(tokens, schema);
      setValidationResult(result);

      // Upload to storage
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const storagePath = `${organization?.id || user.id}/${documentType}/v${Date.now()}.docx`;
      const { error: uploadError } = await supabase.storage
        .from("docx-templates")
        .upload(storagePath, file);

      if (uploadError) throw uploadError;

      // Determine next version
      const currentMaxVersion = templates?.length ? Math.max(...templates.map((t: any) => t.version)) : 0;

      // Create template record
      const validationStatus = !result.can_activate
        ? "blocked"
        : result.warnings.length > 0
        ? "warning"
        : "valid";

      const { error: insertError } = await (supabase
        .from("custom_docx_templates" as any)
        .insert({
          organization_id: organization?.id || null,
          user_id: user.id,
          document_type: documentType,
          version: currentMaxVersion + 1,
          display_name: file.name.replace(".docx", ""),
          schema_version: schema.schema_version,
          storage_path: storagePath,
          upload_sha256: sha256,
          file_size_bytes: file.size,
          placeholders_found: result.placeholders_found,
          missing_required_placeholders: result.missing_required_placeholders,
          unknown_placeholders: result.unknown_placeholders,
          invalid_tokens: result.invalid_tokens,
          conditional_blocks_found: result.conditional_blocks_found,
          validation_status: validationStatus,
          validated_at: new Date().toISOString(),
        }) as any);

      if (insertError) throw insertError;

      queryClient.invalidateQueries({ queryKey: ["custom-docx-templates"] });
      toast.success(result.can_activate
        ? "Plantilla subida y validada correctamente"
        : "Plantilla subida pero tiene errores de validación"
      );
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [schema, organization, documentType, templates, queryClient]);

  // Activate template
  const activateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      // Deactivate all others for this doc type + org
      if (organization) {
        await (supabase
          .from("custom_docx_templates" as any)
          .update({ is_active: false })
          .eq("document_type", documentType)
          .eq("organization_id", organization.id) as any);
      }

      // Activate this one
      const { error } = await (supabase
        .from("custom_docx_templates" as any)
        .update({ is_active: true })
        .eq("id", templateId) as any);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-docx-templates"] });
      toast.success("Plantilla activada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  // Deactivate
  const deactivateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await (supabase
        .from("custom_docx_templates" as any)
        .update({ is_active: false })
        .eq("id", templateId) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-docx-templates"] });
      toast.success("Plantilla desactivada — se usará la plantilla del sistema");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: async (template: any) => {
      // Delete from storage
      await supabase.storage.from("docx-templates").remove([template.storage_path]);
      // Delete record
      const { error } = await (supabase
        .from("custom_docx_templates" as any)
        .delete()
        .eq("id", template.id) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-docx-templates"] });
      toast.success("Plantilla eliminada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  const copyPlaceholder = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const copyAllRequired = () => {
    const text = schema.placeholders.required.map(p => `{{${p.key}}}`).join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Placeholders requeridos copiados al portapapeles");
  };

  return (
    <div className="space-y-4">
      {/* Help Panel */}
      <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <CardTitle className="flex items-center gap-2 text-base">
                <HelpCircle className="h-5 w-5 text-primary" />
                Cómo formatear su plantilla DOCX
              </CardTitle>
              <ChevronDown className={`h-4 w-4 transition-transform ${helpOpen ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Required placeholders */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-destructive">Placeholders requeridos</Label>
                  <Button variant="outline" size="sm" onClick={copyAllRequired}>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copiar todos
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {schema.placeholders.required.map(p => (
                    <div
                      key={p.key}
                      className="flex items-center justify-between px-2 py-1.5 rounded bg-destructive/5 border border-destructive/10 text-xs"
                    >
                      <div>
                        <code className="font-mono font-bold">{`{{${p.key}}}`}</code>
                        <span className="ml-1.5 text-muted-foreground">— {p.description}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => copyPlaceholder(p.key)}
                      >
                        {copiedKey === p.key ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional placeholders */}
              {schema.placeholders.optional.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-amber-600">Placeholders opcionales</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {schema.placeholders.optional.map(p => (
                      <div
                        key={p.key}
                        className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs"
                      >
                        <div>
                          <code className="font-mono font-bold">{`{{${p.key}}}`}</code>
                          <span className="ml-1.5 text-muted-foreground">— {p.description}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => copyPlaceholder(p.key)}
                        >
                          {copiedKey === p.key ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Examples */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Ejemplos</Label>
                <div className="space-y-2 text-xs">
                  <div className="p-3 rounded-lg bg-muted/50 border">
                    <p className="font-medium mb-1">✅ Correcto:</p>
                    <code className="block font-mono text-emerald-700 dark:text-emerald-400">
                      Yo, {`{{CLIENT_FULL_NAME}}`}, identificado con {`{{CLIENT_ID_LABEL}}`} No. {`{{CLIENT_ID_NUMBER}}`}…
                    </code>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border">
                    <p className="font-medium mb-1">✅ Bloque condicional (para campos opcionales):</p>
                    <code className="block font-mono text-emerald-700 dark:text-emerald-400">
                      {`{{#IF RADICADO_NUMBER}}`}Radicado: {`{{RADICADO_NUMBER}}`}{`{{/IF}}`}
                    </code>
                  </div>
                  <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <p className="font-medium mb-1">❌ Errores comunes:</p>
                    <ul className="list-disc list-inside space-y-1 text-destructive/80">
                      <li>Usar minúsculas: <code className="font-mono">{`{{client_name}}`}</code></li>
                      <li>Espacios dentro: <code className="font-mono">{`{{ CITY }}`}</code></li>
                      <li>Caracteres especiales: <code className="font-mono">{`{{NOMBRE_CLIENTÉ}}`}</code></li>
                      <li>Olvidar placeholders requeridos</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Word puede dividir el texto de los placeholders en múltiples "runs" internos (ej. al cambiar formato).
                  Nuestro sistema reconstruye el texto para detectarlos correctamente. Si tiene problemas, escriba el placeholder
                  de una sola vez sin cambiar formato en medio de las llaves.
                </span>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5" />
            Subir plantilla DOCX — {templateLabel}
          </CardTitle>
          <CardDescription>
            Suba un archivo .docx con placeholders {`{{CLAVE}}`} para personalizar la generación de documentos.
            {activeTemplate && (
              <Badge variant="default" className="ml-2">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Plantilla personalizada activa (v{activeTemplate.version})
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              onChange={handleFileUpload}
              disabled={uploading}
              className="flex-1"
            />
            {uploading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          </div>

          {/* Validation Results */}
          {validationResult && (
            <div className="space-y-3">
              <Separator />
              <div className="space-y-2">
                {validationResult.can_activate ? (
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">Plantilla válida — puede activarla</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">No se puede activar — corrija los errores</span>
                  </div>
                )}

                {/* Errors */}
                {validationResult.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}

                {/* Warnings */}
                {validationResult.warnings.map((warn, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{warn}</span>
                  </div>
                ))}

                {/* Found placeholders */}
                <div className="text-xs text-muted-foreground">
                  Encontrados: {validationResult.placeholders_found.length} placeholders, {validationResult.conditional_blocks_found.length} bloques condicionales
                </div>
              </div>
            </div>
          )}

          {/* Existing Templates List */}
          {templates && templates.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-medium">Versiones de plantilla</Label>
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-2">
                    {templates.map((t: any) => (
                      <div
                        key={t.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          t.is_active ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <span className="text-sm font-medium">{t.display_name}</span>
                            <span className="text-xs text-muted-foreground ml-2">v{t.version}</span>
                            {t.is_active && <Badge variant="default" className="ml-2 text-xs">Activa</Badge>}
                            {t.is_immutable && (
                              <Badge variant="outline" className="ml-1 text-xs">
                                <Shield className="h-3 w-3 mr-0.5" /> Inmutable
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge
                            variant={
                              t.validation_status === "valid" ? "default" :
                              t.validation_status === "warning" ? "secondary" : "destructive"
                            }
                            className="text-xs"
                          >
                            {t.validation_status === "valid" && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                            {t.validation_status === "warning" && <AlertTriangle className="h-3 w-3 mr-0.5" />}
                            {t.validation_status === "blocked" && <AlertCircle className="h-3 w-3 mr-0.5" />}
                            {t.validation_status}
                          </Badge>

                          {!t.is_active && t.validation_status !== "blocked" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => activateMutation.mutate(t.id)}
                              disabled={activateMutation.isPending}
                            >
                              <ToggleRight className="h-3.5 w-3.5 mr-1" />
                              Activar
                            </Button>
                          )}

                          {t.is_active && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deactivateMutation.mutate(t.id)}
                              disabled={deactivateMutation.isPending}
                            >
                              Desactivar
                            </Button>
                          )}

                          {!t.is_immutable && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>¿Eliminar plantilla?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Se eliminará la plantilla "{t.display_name}" v{t.version}. Esta acción no se puede deshacer.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(t)}>
                                    Eliminar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}

          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
