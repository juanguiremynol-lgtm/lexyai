import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Download, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type DocumentKind = Database["public"]["Enums"]["document_kind"];

const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  DEMANDA: "Demanda",
  ACTA_REPARTO: "Acta de Reparto",
  AUTO_RECEIPT: "Auto de Recibo",
  COURT_RESPONSE: "Respuesta del Juzgado",
  OTHER: "Otro",
};

interface Document {
  id: string;
  kind: DocumentKind;
  original_filename: string;
  file_path: string;
  uploaded_at: string;
}

interface DocumentListProps {
  documents: Document[];
  filingId: string;
}

export function DocumentList({ documents, filingId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deletePath, setDeletePath] = useState<string | null>(null);

  const deleteDocument = useMutation({
    mutationFn: async ({ id, filePath }: { id: string; filePath: string }) => {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("lexdocket")
        .remove([filePath]);
      
      if (storageError) {
        console.warn("Storage delete error:", storageError);
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from("documents")
        .delete()
        .eq("id", id);
      
      if (dbError) throw dbError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filing", filingId] });
      toast.success("Documento eliminado");
      setDeleteId(null);
      setDeletePath(null);
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleDownload = async (filePath: string, filename: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("lexdocket")
        .download(filePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error("Error al descargar el archivo");
      console.error(error);
    }
  };

  const handleOpenInNewTab = async (filePath: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("lexdocket")
        .createSignedUrl(filePath, 3600);

      if (error) throw error;

      window.open(data.signedUrl, "_blank");
    } catch (error) {
      toast.error("Error al abrir el archivo");
      console.error(error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  if (documents.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/50 hover:bg-muted transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">{doc.original_filename}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs">
                    {DOCUMENT_KIND_LABELS[doc.kind]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(doc.uploaded_at)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleOpenInNewTab(doc.file_path)}
                title="Abrir en nueva pestaña"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDownload(doc.file_path, doc.original_filename)}
                title="Descargar"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setDeleteId(doc.id);
                  setDeletePath(doc.file_path);
                }}
                title="Eliminar"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El documento será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId && deletePath) {
                  deleteDocument.mutate({ id: deleteId, filePath: deletePath });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
