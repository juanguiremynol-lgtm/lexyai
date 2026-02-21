/**
 * BulkDocumentExport — Settings panel for bulk-exporting all org documents.
 * 
 * AUTHORIZATION: Admin-only (enforced on UI + backend).
 * FEATURES: Confirmation modal, bounded concurrency, audit logging.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, AlertTriangle, Loader2, CheckCircle2, FileArchive, ShieldAlert } from "lucide-react";

const MAX_CONCURRENCY = 5;

interface BulkDocumentExportProps {
  isOrgAdmin: boolean;
  bulkExportEnabled: boolean;
}

async function downloadWithConcurrency(
  entries: [string, string][],
  concurrency: number,
  onProgress: (done: number) => void,
): Promise<Map<string, Blob>> {
  const results = new Map<string, Blob>();
  let idx = 0;
  let done = 0;

  async function next(): Promise<void> {
    while (idx < entries.length) {
      const current = idx++;
      const [id, url] = entries[current];
      try {
        const res = await fetch(url);
        if (res.ok) {
          results.set(id, await res.blob());
        }
      } catch (e) {
        console.warn(`Download failed for ${id}:`, e);
      }
      done++;
      onProgress(done);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export function BulkDocumentExport({ isOrgAdmin, bulkExportEnabled }: BulkDocumentExportProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");

  if (!isOrgAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Exportación Masiva de Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Acceso restringido</AlertTitle>
            <AlertDescription>
              Solo los administradores de la organización pueden ejecutar exportaciones masivas.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!bulkExportEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Exportación Masiva de Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Función deshabilitada</AlertTitle>
            <AlertDescription>
              La exportación masiva no está habilitada para esta organización. Contacte al soporte para activarla.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

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

      const { manifest, manifest_sha256, download_urls, proof_urls, audit } = data;
      setProgress(15);

      const totalFiles = Object.keys(download_urls).length + Object.keys(proof_urls || {}).length;
      setStatusText(`Descargando ${totalFiles} archivos (concurrencia: ${MAX_CONCURRENCY})...`);

      // 2. Dynamically import JSZip
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      // 3. Add manifest
      const manifestJson = JSON.stringify(manifest, null, 2);
      zip.file("export_manifest.json", manifestJson);

      // 4. Add README
      const readme = [
        "═══════════════════════════════════════════════",
        "  ATENIA — EXPORTACIÓN MASIVA DE DOCUMENTOS",
        `  Fecha: ${new Date().toISOString()}`,
        `  Manifest SHA-256: ${manifest_sha256}`,
        "═══════════════════════════════════════════════",
        "",
        `Total documentos: ${manifest.total_documents}`,
        `Documentos finalizados: ${manifest.finalized_documents}`,
        `Pruebas externas: ${manifest.total_external_proofs}`,
        `Alcance: ${manifest.export_scope}`,
        "",
        "ESTRUCTURA DEL ARCHIVO:",
        "├── export_manifest.json  — Manifiesto con hashes SHA-256 por archivo",
        "├── README.txt            — Este archivo",
        "├── documents/            — PDFs de documentos",
        "└── external_proofs/      — Pruebas de entrega externa",
        "",
        "VERIFICACIÓN:",
        "1. Cada documento tiene final_pdf_sha256 en el manifiesto",
        "2. Cada prueba externa tiene client_sha256 y server_sha256",
        "3. chain_validated indica si la cadena de hash de eventos es íntegra",
        "4. Use /verify para verificar Evidence Packs individuales",
        "",
        "RETENCIÓN LEGAL:",
        "Los documentos finalizados están sujetos a periodos de retención",
        "legal. Consulte retention_expires_at en el manifiesto.",
        "Documentos con legal_hold=true no pueden ser eliminados.",
        "",
        "AUDITORÍA:",
        `Export requested hash: ${audit?.requested_hash ?? "N/A"}`,
        `Export ready hash: ${audit?.ready_hash ?? "N/A"}`,
        "",
        "MARCO LEGAL:",
        "- Ley 527 de 1999 (Comercio Electrónico, Colombia)",
        "- Decreto 2364 de 2012 (Firma Electrónica)",
        "- Decreto 806 de 2020 (Virtualidad Procesal)",
        "",
        "© Andromeda Legal — LEX ET LITTERAE S.A.S.",
      ].join("\n");
      zip.file("README.txt", readme);

      // 5. Download documents with bounded concurrency
      const docsFolder = zip.folder("documents");
      const docEntries = Object.entries(download_urls) as [string, string][];
      let totalDownloaded = 0;

      const docBlobs = await downloadWithConcurrency(docEntries, MAX_CONCURRENCY, (done) => {
        totalDownloaded = done;
        setProgress(15 + Math.round((done / Math.max(totalFiles, 1)) * 65));
        setStatusText(`Descargando archivo ${done}/${totalFiles}...`);
      });

      for (const [docId, blob] of docBlobs) {
        const docMeta = manifest.documents.find((d: { id: string }) => d.id === docId);
        const safeName = (docMeta?.title || docId)
          .replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ ]/g, "")
          .replace(/\s+/g, "_")
          .substring(0, 60);
        docsFolder?.file(`${safeName}_${docId.slice(0, 8)}.pdf`, blob);
      }

      // 6. Download external proofs with bounded concurrency
      if (proof_urls && Object.keys(proof_urls).length > 0) {
        const proofsFolder = zip.folder("external_proofs");
        const proofEntries = Object.entries(proof_urls) as [string, string][];

        const proofBlobs = await downloadWithConcurrency(proofEntries, MAX_CONCURRENCY, (done) => {
          const total = totalDownloaded + done;
          setProgress(15 + Math.round((total / Math.max(totalFiles, 1)) * 65));
          setStatusText(`Descargando archivo ${total}/${totalFiles}...`);
        });

        for (const [proofId, blob] of proofBlobs) {
          const allProofs = manifest.documents.flatMap((d: any) => d.external_proofs || []);
          const proofMeta = allProofs.find((p: { id: string }) => p.id === proofId);
          const fileName = proofMeta?.file_name || `proof_${proofId}`;
          proofsFolder?.file(fileName, blob);
        }
      }

      // 7. Generate ZIP
      setProgress(85);
      setStatusText("Generando archivo ZIP...");
      const blob = await zip.generateAsync({ type: "blob" });

      // 8. Log DOWNLOADED audit event
      setStatusText("Registrando evento de auditoría...");
      try {
        await supabase.functions.invoke("log-audit", {
          body: {
            organizationId: manifest.organization_id,
            action: "DATA_EXPORTED",
            entityType: "organization",
            entityId: manifest.organization_id,
            metadata: {
              export_type: "BULK_ARCHIVE",
              manifest_sha256: manifest_sha256,
              total_documents: manifest.total_documents,
              total_proofs: manifest.total_external_proofs,
              zip_size_bytes: blob.size,
            },
          },
        });
      } catch (e) {
        console.warn("Audit log for download failed:", e);
      }

      // 9. Trigger download
      setProgress(95);
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
          Descargue todos los documentos finalizados, paquetes de evidencia y pruebas externas
          en un único archivo ZIP verificable. Incluye manifiesto con hashes SHA-256.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="default">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Importante</AlertTitle>
          <AlertDescription>
            La exportación incluye todos los PDFs, pruebas de entrega externa,
            y un manifiesto con hashes SHA-256 por documento y estado de validación de cadena.
            Los documentos con retención legal activa o "legal hold" están incluidos pero no pueden eliminarse.
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={loading} className="gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {loading ? "Exportando..." : "Exportar Todo"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar Exportación Masiva</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción descargará todos los documentos de su organización en un archivo ZIP.
                  La exportación será registrada en el log de auditoría inmutable con hashes criptográficos.
                  <br /><br />
                  <strong>Este proceso puede tomar varios minutos</strong> dependiendo del volumen de documentos.
                  No cierre la pestaña durante la descarga.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkExport}>
                  Confirmar y Exportar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
