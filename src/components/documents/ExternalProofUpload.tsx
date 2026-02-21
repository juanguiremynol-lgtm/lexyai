/**
 * ExternalProofUpload — Upload external delivery/publication proof files
 * (e.g., Servientrega receipts, publication screenshots) for notificaciones.
 * Files are hashed client-side (SHA-256) before upload, and the hash is
 * stored in the append-only evidence_proofs table.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Loader2, CheckCircle2, FileText, Shield, AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ExternalProof {
  id: string;
  label: string;
  file_name: string;
  file_sha256: string;
  created_at: string;
  proof_type: string;
}

interface ExternalProofUploadProps {
  documentId: string;
  organizationId: string;
  existingProofs?: ExternalProof[];
  onProofUploaded?: () => void;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ExternalProofUpload({
  documentId,
  organizationId,
  existingProofs = [],
  onProofUploaded,
}: ExternalProofUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = useCallback((file: File) => {
    const maxSize = 20 * 1024 * 1024; // 20MB
    if (file.size > maxSize) {
      toast.error("El archivo excede el tamaño máximo de 20MB.");
      return;
    }
    setSelectedFile(file);
    if (!label) {
      setLabel(file.name.replace(/\.[^/.]+$/, ""));
    }
  }, [label]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleUpload = async () => {
    if (!selectedFile || !label.trim()) {
      toast.error("Seleccione un archivo y proporcione una etiqueta.");
      return;
    }
    setUploading(true);
    try {
      // 1. Compute SHA-256 hash client-side
      const fileSha256 = await computeFileHash(selectedFile);

      // 2. Upload to storage
      const filePath = `${organizationId}/${documentId}/${crypto.randomUUID()}_${selectedFile.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("evidence-proofs")
        .upload(filePath, selectedFile);

      if (uploadErr) throw uploadErr;

      // 3. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 4. Insert proof record with hash
      const { error: insertErr } = await supabase
        .from("document_evidence_proofs")
        .insert({
          organization_id: organizationId,
          document_id: documentId,
          uploaded_by: user.id,
          proof_type: "external_delivery",
          label: label.trim(),
          file_path: filePath,
          file_name: selectedFile.name,
          file_size_bytes: selectedFile.size,
          mime_type: selectedFile.type || "application/octet-stream",
          file_sha256: fileSha256,
          metadata: {
            uploaded_at: new Date().toISOString(),
            original_name: selectedFile.name,
          },
        });

      if (insertErr) throw insertErr;

      toast.success("Prueba de entrega subida y registrada con hash SHA-256.");
      setSelectedFile(null);
      setLabel("");
      onProofUploaded?.();
    } catch (err) {
      console.error("Proof upload error:", err);
      toast.error("Error al subir la prueba: " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" />
          Pruebas de Entrega Externa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800 dark:text-blue-200">
            Suba aquí el certificado de entrega de Servientrega Digital, comprobante de publicación,
            o cualquier prueba de entrega/publicación externa. Cada archivo será hasheado (SHA-256)
            e incluido en el Evidence Pack del documento.
          </p>
        </div>

        {/* Existing proofs */}
        {existingProofs.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Pruebas registradas</Label>
            {existingProofs.map((proof) => (
              <div key={proof.id} className="flex items-center gap-3 p-2 rounded border bg-muted/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{proof.label}</p>
                  <p className="text-xs text-muted-foreground truncate font-mono">
                    SHA-256: {proof.file_sha256.substring(0, 16)}...
                  </p>
                </div>
                <Badge variant="outline" className="text-xs shrink-0">
                  {new Date(proof.created_at).toLocaleDateString("es-CO")}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Upload area */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm">Etiqueta</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ej. Certificado Servientrega — Juan Pérez"
              maxLength={200}
            />
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("proof-upload")?.click()}
          >
            <input
              id="proof-upload"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
              className="hidden"
            />
            {selectedFile ? (
              <div className="space-y-1">
                <FileText className="h-6 w-6 mx-auto text-primary" />
                <p className="text-sm font-medium">{selectedFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(0)} KB
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Arrastre un archivo o haga clic para seleccionar
                </p>
                <p className="text-xs text-muted-foreground">
                  PDF, PNG, JPG (máx. 20MB)
                </p>
              </div>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={uploading || !selectedFile || !label.trim()}
            className="w-full"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Subir y Registrar Prueba
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
