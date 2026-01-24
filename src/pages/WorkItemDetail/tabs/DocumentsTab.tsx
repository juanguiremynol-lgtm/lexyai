/**
 * Documents Tab - Shows documents associated with the work item
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FileText, 
  Download,
  ExternalLink,
  Upload,
  File,
  FileImage,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";

interface DocumentsTabProps {
  workItem: WorkItem & { _source?: string };
}

interface Document {
  id: string;
  filename: string;
  kind: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  DEMANDA: "Demanda",
  PODER: "Poder",
  ANEXO: "Anexo",
  ACTA_REPARTO: "Acta de Reparto",
  AUTO: "Auto",
  NOTIFICACION: "Notificación",
  MEMORIAL: "Memorial",
  SENTENCIA: "Sentencia",
  RECURSO: "Recurso",
  OTHER: "Otro",
};

export function DocumentsTab({ workItem }: DocumentsTabProps) {
  // Fetch documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ["work-item-documents", workItem.id],
    queryFn: async () => {
      const legacyFilingId = workItem.legacy_filing_id;
      
      if (!legacyFilingId) return [];
      
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("filing_id", legacyFilingId)
        .order("uploaded_at", { ascending: false });
      
      if (error) throw error;
      // Map database fields to component interface
      return (data || []).map((d: any) => ({
        id: d.id,
        filename: d.original_filename,
        kind: d.kind,
        file_path: d.file_path,
        mime_type: null,
        file_size: null,
        created_at: d.uploaded_at,
      })) as Document[];
    },
    enabled: !!workItem.legacy_filing_id,
  });

  const handleDownload = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .download(doc.file_path);
      
      if (error) throw error;
      
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error("Error al descargar: " + (error as Error).message);
    }
  };

  const handleOpenInNewTab = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.file_path, 3600);
      
      if (error) throw error;
      
      window.open(data.signedUrl, "_blank");
    } catch (error) {
      toast.error("Error al abrir: " + (error as Error).message);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string | null) => {
    if (mimeType?.startsWith("image/")) return FileImage;
    return File;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documentos
              <Badge variant="secondary" className="ml-2">
                {documents?.length || 0} archivos
              </Badge>
            </CardTitle>
            {workItem.legacy_filing_id && (
              <Button variant="outline" size="sm" disabled>
                <Upload className="h-4 w-4 mr-2" />
                Subir Documento
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {!documents || documents.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin documentos</h3>
              <p className="text-muted-foreground text-sm">
                {workItem.legacy_filing_id 
                  ? "Los documentos subidos aparecerán aquí."
                  : "Este asunto no tiene documentos asociados aún."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const FileIcon = getFileIcon(doc.mime_type);

            return (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                      <FileIcon className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{doc.filename}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {DOCUMENT_KIND_LABELS[doc.kind] || doc.kind}
                        </Badge>
                        <span>{formatFileSize(doc.file_size)}</span>
                        <span>{format(new Date(doc.created_at), "d MMM yyyy", { locale: es })}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenInNewTab(doc)}
                        title="Abrir en nueva pestaña"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(doc)}
                        title="Descargar"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
