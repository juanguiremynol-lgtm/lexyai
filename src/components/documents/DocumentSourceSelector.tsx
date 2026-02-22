/**
 * DocumentSourceSelector — Choose between System Template, DOCX Template, or Upload PDF
 * for contract creation. Integrated into Step 1 of the document wizard.
 */

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileText, Upload, CheckCircle2, AlertTriangle, File, X, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type DocumentSourceType = "SYSTEM_TEMPLATE" | "DOCX_TEMPLATE" | "UPLOADED_PDF";

interface DocumentSourceSelectorProps {
  sourceType: DocumentSourceType;
  onSourceTypeChange: (type: DocumentSourceType) => void;
  organizationId: string;
  documentId?: string;
  onPdfUploaded: (data: {
    storagePath: string;
    sha256: string;
    fileName: string;
    sizeBytes: number;
  }) => void;
  uploadedPdfInfo?: {
    storagePath: string;
    sha256: string;
    fileName: string;
    sizeBytes: number;
  } | null;
  onClearUpload: () => void;
}

async function computeSha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const MAX_PDF_SIZE = 20 * 1024 * 1024; // 20MB

export function DocumentSourceSelector({
  sourceType,
  onSourceTypeChange,
  organizationId,
  documentId,
  onPdfUploaded,
  uploadedPdfInfo,
  onClearUpload,
}: DocumentSourceSelectorProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Solo se aceptan archivos PDF");
      return;
    }

    if (file.size > MAX_PDF_SIZE) {
      toast.error(`El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 20MB`);
      return;
    }

    setUploading(true);
    setUploadProgress(20);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setUploadProgress(40);

      // Compute SHA-256
      const sha256 = await computeSha256(bytes);
      setUploadProgress(60);

      // Generate a temp document ID if not provided
      const docId = documentId || crypto.randomUUID();
      const storagePath = `${organizationId}/${docId}/source.pdf`;

      // Upload to unsigned-documents bucket
      const { error: uploadErr } = await supabase.storage
        .from("unsigned-documents")
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) {
        throw new Error(`Error al subir: ${uploadErr.message}`);
      }

      setUploadProgress(90);

      // Generate preview URL
      const { data: urlData } = await supabase.storage
        .from("unsigned-documents")
        .createSignedUrl(storagePath, 3600); // 1 hour

      if (urlData?.signedUrl) {
        setPreviewUrl(urlData.signedUrl);
      }

      setUploadProgress(100);

      onPdfUploaded({
        storagePath,
        sha256,
        fileName: file.name,
        sizeBytes: file.size,
      });

      toast.success("PDF subido correctamente");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(msg);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [organizationId, documentId, onPdfUploaded]);

  const handleClear = useCallback(() => {
    setPreviewUrl(null);
    onClearUpload();
  }, [onClearUpload]);

  const sources: { type: DocumentSourceType; label: string; description: string; icon: typeof FileText }[] = [
    {
      type: "SYSTEM_TEMPLATE",
      label: "Plantilla Andromeda",
      description: "Usa nuestra plantilla estándar con variables personalizables",
      icon: FileText,
    },
    {
      type: "UPLOADED_PDF",
      label: "Subir mi PDF",
      description: "Sube un PDF ya redactado (sin firmar). Agregaremos firmas + certificado de auditoría",
      icon: Upload,
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-1">Origen del documento</h4>
        <p className="text-xs text-muted-foreground">
          Elige cómo crear el contrato: con nuestra plantilla o subiendo tu propio PDF.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sources.map(({ type, label, description, icon: Icon }) => (
          <Card
            key={type}
            className={`cursor-pointer transition-all hover:shadow-sm ${
              sourceType === type
                ? "ring-2 ring-primary bg-primary/5"
                : "hover:border-primary/30"
            }`}
            onClick={() => onSourceTypeChange(type)}
          >
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">{label}</span>
                {sourceType === type && (
                  <Badge variant="outline" className="ml-auto text-xs bg-primary/10 text-primary border-primary/20">
                    Activo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Upload PDF section */}
      {sourceType === "UPLOADED_PDF" && (
        <div className="space-y-4 p-4 rounded-lg border border-dashed border-primary/30 bg-primary/5">
          {/* Checklist */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Requisitos del PDF:</p>
            {[
              "El PDF debe estar sin firmar y ser definitivo",
              "No se requieren marcadores de posición (placeholders)",
              "Agregaremos bloques de firma + páginas de auditoría al final del documento",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span className="text-xs text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>

          {/* Upload area or uploaded file info */}
          {!uploadedPdfInfo ? (
            <div className="relative">
              <label
                className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                  uploading
                    ? "border-primary/50 bg-primary/10"
                    : "border-muted-foreground/20 hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {uploading ? (
                  <>
                    <Progress value={uploadProgress} className="w-48 h-2" />
                    <span className="text-xs text-muted-foreground">Subiendo y verificando...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Arrastra o haz clic para subir PDF
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Máximo 20MB · Solo archivos PDF
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="application/pdf"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              {/* File info card */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-background border">
                <File className="h-8 w-8 text-destructive shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{uploadedPdfInfo.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadedPdfInfo.sizeBytes / 1024).toFixed(0)} KB · SHA-256: {uploadedPdfInfo.sha256.substring(0, 12)}…
                  </p>
                </div>
                <div className="flex gap-1">
                  {previewUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(previewUrl, "_blank")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Integrity notice */}
              <div className="flex items-start gap-2 p-2 rounded bg-accent/50 border border-accent">
                <AlertTriangle className="h-3.5 w-3.5 text-accent-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-accent-foreground">
                  El hash SHA-256 del PDF original será incluido en el certificado de auditoría para garantizar la integridad del documento fuente.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
