/**
 * EvidencePackButton — Downloads the full evidence pack ZIP for a finalized document.
 * Assembles ZIP client-side from edge function manifest + artifact URLs.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EvidencePackButtonProps {
  documentId: string;
  documentTitle?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export function EvidencePackButton({
  documentId,
  documentTitle,
  variant = "outline",
  size = "sm",
  className,
}: EvidencePackButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-evidence-pack", {
        body: { document_id: documentId },
      });

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Error generating evidence pack");
      }

      // Dynamically import JSZip
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      // Add manifest
      zip.file("manifest.json", data.manifest_json);

      // Add events JSONL
      zip.file("raw_events.jsonl", data.events_jsonl);

      // Add README
      zip.file("README.txt", data.readme_txt);

      // Download and add signed PDFs
      if (data.download_urls) {
        for (const [key, url] of Object.entries(data.download_urls)) {
          try {
            const res = await fetch(url as string);
            if (res.ok) {
              const blob = await res.blob();
              const isCert = key.startsWith("cert_");
              const fileName = isCert
                ? `audit_certificate_${key.replace("cert_", "")}.pdf`
                : `signed_document_${key}.pdf`;
              zip.file(fileName, blob);
            }
          } catch (e) {
            console.warn(`Could not download artifact ${key}:`, e);
          }
        }
      }

      // Download and add source PDF (UPLOADED_PDF documents)
      if (data.source_pdf_url) {
        try {
          const res = await fetch(data.source_pdf_url as string);
          if (res.ok) {
            const blob = await res.blob();
            zip.file("source_document.pdf", blob);
          }
        } catch (e) {
          console.warn("Could not download source PDF:", e);
        }
      }

      // Download and add external proofs
      if (data.proof_urls) {
        const proofFolder = zip.folder("external_proofs");
        for (const [proofId, url] of Object.entries(data.proof_urls)) {
          try {
            const res = await fetch(url as string);
            if (res.ok) {
              const blob = await res.blob();
              const proofMeta = data.manifest?.external_proofs?.find(
                (p: { id: string }) => p.id === proofId
              );
              const fileName = proofMeta?.file_name || `proof_${proofId}`;
              proofFolder?.file(fileName, blob);
            }
          } catch (e) {
            console.warn(`Could not download proof ${proofId}:`, e);
          }
        }
      }

      // Generate and download ZIP
      const blob = await zip.generateAsync({ type: "blob" });
      const safeName = (documentTitle || "document")
        .replace(/[^a-zA-Z0-9_\- ]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 50);
      const fileName = `EvidencePack_${safeName}_${new Date().toISOString().split("T")[0]}.zip`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);

      toast.success("Evidence Pack descargado");
    } catch (err) {
      console.error("Evidence pack download error:", err);
      toast.error("Error al generar el Evidence Pack: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleDownload}
      disabled={loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
      ) : (
        <Package className="h-4 w-4 mr-2" />
      )}
      Evidence Pack
    </Button>
  );
}
