/**
 * BulkDocumentExport — Settings panel component for bulk-exporting all
 * org documents, evidence packs, and external proofs before deactivation.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Package, AlertTriangle, Loader2, CheckCircle2, FileArchive } from "lucide-react";

export function BulkDocumentExport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");

  const handleBulkExport = async () => {
    setLoading(true);
    setProgress(5);
    setStatusText("Generando manifiesto de exportación...");

    try {
      // 1. Fetch the bulk export manifest
      const { data, error } = await supabase.functions.invoke("bulk-export-documents");

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Error al generar exportación");
      }

      const { manifest, download_urls, proof_urls } = data;
      setProgress(15);
      setStatusText(`Descargando ${manifest.total_documents} documentos...`);

      // 2. Dynamically import JSZip
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      // 3. Add manifest
      zip.file("export_manifest.json", JSON.stringify(manifest, null, 2));

      // 4. Add README
      const readme = [
        "═══════════════════════════════════════════════",
        "  ATENIA — EXPORTACIÓN MASIVA DE DOCUMENTOS",
        `  Fecha: ${new Date().toISOString()}`,
        "═══════════════════════════════════════════════",
        "",
        `Total documentos: ${manifest.total_documents}`,
        `Documentos finalizados: ${manifest.finalized_documents}`,
        `Pruebas externas: ${manifest.total_external_proofs}`,
        "",
        "ESTRUCTURA DEL ARCHIVO:",
        "├── export_manifest.json  — Manifiesto completo con metadatos",
        "├── README.txt            — Este archivo",
        "├── documents/            — PDFs de documentos",
        "└── external_proofs/      — Pruebas de entrega externa",
        "",
        "RETENCIÓN LEGAL:",
        "Los documentos finalizados están sujetos a periodos de retención",
        "legal. Consulte retention_expires_at en el manifiesto.",
        "",
        "VERIFICACIÓN:",
        "Los Evidence Packs individuales pueden verificarse en /verify",
        "sin necesidad de autenticación.",
      ].join("\n");
      zip.file("README.txt", readme);

      // 5. Download documents
      const docsFolder = zip.folder("documents");
      const totalFiles = Object.keys(download_urls).length + Object.keys(proof_urls || {}).length;
      let downloaded = 0;

      for (const [docId, url] of Object.entries(download_urls)) {
        try {
          const res = await fetch(url as string);
          if (res.ok) {
            const blob = await res.blob();
            const docMeta = manifest.documents.find((d: { id: string }) => d.id === docId);
            const safeName = (docMeta?.title || docId)
              .replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ ]/g, "")
              .replace(/\s+/g, "_")
              .substring(0, 60);
            docsFolder?.file(`${safeName}_${docId.slice(0, 8)}.pdf`, blob);
          }
        } catch (e) {
          console.warn(`Could not download doc ${docId}:`, e);
        }
        downloaded++;
        setProgress(15 + Math.round((downloaded / totalFiles) * 70));
        setStatusText(`Descargando archivo ${downloaded}/${totalFiles}...`);
      }

      // 6. Download external proofs
      if (proof_urls && Object.keys(proof_urls).length > 0) {
        const proofsFolder = zip.folder("external_proofs");
        for (const [proofId, url] of Object.entries(proof_urls)) {
          try {
            const res = await fetch(url as string);
            if (res.ok) {
              const blob = await res.blob();
              const proofMeta = manifest.external_proofs.find(
                (p: { id: string }) => p.id === proofId
              );
              const fileName = proofMeta?.file_name || `proof_${proofId}`;
              proofsFolder?.file(fileName, blob);
            }
          } catch (e) {
            console.warn(`Could not download proof ${proofId}:`, e);
          }
          downloaded++;
          setProgress(15 + Math.round((downloaded / totalFiles) * 70));
          setStatusText(`Descargando archivo ${downloaded}/${totalFiles}...`);
        }
      }

      // 7. Generate ZIP
      setProgress(90);
      setStatusText("Generando archivo ZIP...");
      const blob = await zip.generateAsync({ type: "blob" });

      // 8. Trigger download
      const fileName = `ATENIA_Export_${new Date().toISOString().split("T")[0]}.zip`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

      setProgress(100);
      setStatusText("¡Exportación completada!");
      toast.success(`Exportación completada: ${manifest.total_documents} documentos descargados`);
    } catch (err) {
      console.error("Bulk export error:", err);
      toast.error("Error en la exportación: " + (err as Error).message);
      setStatusText("");
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileArchive className="h-5 w-5" />
          Exportación Masiva de Documentos
        </CardTitle>
        <CardDescription>
          Descargue todos los documentos, paquetes de evidencia y pruebas externas de su organización
          en un único archivo ZIP. Recomendado antes de desactivar su cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="default">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Importante</AlertTitle>
          <AlertDescription>
            La exportación incluye todos los documentos PDF, pruebas de entrega externa, 
            y metadatos con hashes SHA-256 para verificación posterior. Los documentos 
            finalizados están sujetos a periodos de retención legal (por defecto 10 años).
          </AlertDescription>
        </Alert>

        {loading && (
          <div className="space-y-3">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              {progress < 100 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
              {statusText}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleBulkExport}
            disabled={loading}
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {loading ? "Exportando..." : "Exportar Todo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
