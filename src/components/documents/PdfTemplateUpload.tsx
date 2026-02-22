/**
 * PdfTemplateUpload — Upload and manage a default unsigned PDF template
 * for contract generation (contrato_servicios).
 * Stores in unsigned-documents bucket under org defaults path.
 */

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Upload, FileText, CheckCircle2, Loader2, Trash2, Info, FileUp,
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";

interface PdfTemplateUploadProps {
  documentType: string;
}

async function computeSha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PdfTemplateUpload({ documentType }: PdfTemplateUploadProps) {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);

  const orgId = organization?.id;

  // Fetch existing default PDF template
  const { data: defaultTemplate, isLoading } = useQuery({
    queryKey: ["pdf-default-template", documentType, orgId],
    queryFn: async () => {
      if (!orgId) return null;
      // List files in the defaults path
      const path = `${orgId}/_defaults/${documentType}`;
      const { data, error } = await supabase.storage
        .from("unsigned-documents")
        .list(path, { limit: 10 });

      if (error || !data || data.length === 0) return null;

      // Find the most recent PDF
      const pdfFiles = data.filter((f) => f.name.endsWith(".pdf"));
      if (pdfFiles.length === 0) return null;

      // Sort by created_at descending
      pdfFiles.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      return {
        name: pdfFiles[0].name,
        path: `${path}/${pdfFiles[0].name}`,
        size: pdfFiles[0].metadata?.size || 0,
        created_at: pdfFiles[0].created_at,
      };
    },
    enabled: !!orgId,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
      toast.error("Solo se permiten archivos PDF");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("El archivo no puede superar 20 MB");
      return;
    }

    if (!orgId) {
      toast.error("Organización no encontrada");
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await computeSha256(buffer);

      // Remove existing defaults
      const existingPath = `${orgId}/_defaults/${documentType}`;
      const { data: existing } = await supabase.storage
        .from("unsigned-documents")
        .list(existingPath, { limit: 10 });

      if (existing && existing.length > 0) {
        const toRemove = existing.map(
          (f) => `${existingPath}/${f.name}`,
        );
        await supabase.storage.from("unsigned-documents").remove(toRemove);
      }

      // Upload new default
      const storagePath = `${existingPath}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("unsigned-documents")
        .upload(storagePath, file, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      queryClient.invalidateQueries({
        queryKey: ["pdf-default-template"],
      });
      toast.success(
        `Plantilla PDF predeterminada guardada (SHA-256: ${sha256.substring(0, 12)}…)`,
      );
    } catch (err) {
      toast.error("Error: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!defaultTemplate) return;
      const { error } = await supabase.storage
        .from("unsigned-documents")
        .remove([defaultTemplate.path]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["pdf-default-template"],
      });
      toast.success("Plantilla PDF predeterminada eliminada");
    },
    onError: (err) => toast.error("Error: " + (err as Error).message),
  });

  const docTypeLabels: Record<string, string> = {
    contrato_servicios: "Contrato de Prestación de Servicios",
    poder_especial: "Poder Especial",
  };

  return (
    <div className="space-y-4">
      {/* Explanation */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="h-5 w-5 text-primary" />
            Plantilla PDF predeterminada — {docTypeLabels[documentType] || documentType}
          </CardTitle>
          <CardDescription>
            Suba un PDF sin firmar que se usará como plantilla predeterminada al crear documentos de este tipo.
            Al generar un nuevo documento, podrá elegir esta plantilla PDF en lugar de la plantilla del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p>• El PDF debe estar <strong>sin firmar</strong> y en su versión final.</p>
              <p>• No se requieren placeholders — el contenido se usa tal cual.</p>
              <p>• Las firmas electrónicas y el certificado de auditoría se añadirán automáticamente al final del documento.</p>
              <p>• Tamaño máximo: 20 MB.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current template */}
      {defaultTemplate && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary/60" />
                <div>
                  <p className="font-medium text-sm">{defaultTemplate.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Subido: {new Date(defaultTemplate.created_at).toLocaleDateString("es-CO")}
                  </p>
                </div>
                <Badge variant="default" className="ml-2">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Activa
                </Badge>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-1" />
                    Eliminar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar plantilla PDF?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se eliminará la plantilla PDF predeterminada. Los documentos ya generados no se verán afectados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate()}
                      className="bg-destructive text-destructive-foreground"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload area */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5" />
            {defaultTemplate ? "Reemplazar plantilla PDF" : "Subir plantilla PDF"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileUpload}
              disabled={uploading || isLoading}
              className="flex-1"
            />
            {uploading && (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
