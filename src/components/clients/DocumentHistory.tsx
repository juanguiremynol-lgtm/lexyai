import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  History, 
  Eye, 
  Copy, 
  Download, 
  FileDown,
  Trash2,
  Loader2,
  FileText
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";
import { DOCUMENT_TYPE_LABELS, DocumentType, formatDateShort } from "@/lib/document-templates";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";

interface ClientDocument {
  id: string;
  document_type: DocumentType;
  document_content: string;
  variables_snapshot: Record<string, string>;
  created_at: string;
}

interface DocumentHistoryProps {
  clientId: string;
  clientName: string;
}

export function DocumentHistory({ clientId, clientName }: DocumentHistoryProps) {
  const queryClient = useQueryClient();
  const [selectedDocument, setSelectedDocument] = useState<ClientDocument | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["client-documents", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_documents")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as ClientDocument[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await supabase
        .from("client_documents")
        .delete()
        .eq("id", documentId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
      toast.success("Documento eliminado");
    },
    onError: () => {
      toast.error("Error al eliminar documento");
    },
  });

  const handleCopyText = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Texto copiado al portapapeles");
    } catch {
      toast.error("Error al copiar");
    }
  };

  const handleExportDocx = async (doc: ClientDocument) => {
    setIsExporting(true);
    try {
      const paragraphs = doc.document_content.split("\n").map(line => 
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 200 },
        })
      );
      
      const docxDoc = new Document({
        sections: [{
          properties: {},
          children: paragraphs,
        }],
      });
      
      const blob = await Packer.toBlob(docxDoc);
      const fileName = `${DOCUMENT_TYPE_LABELS[doc.document_type]}_${clientName.replace(/\s+/g, "_")}_${format(new Date(doc.created_at), "dd-MM-yyyy")}.docx`;
      saveAs(blob, fileName);
      toast.success("Documento DOCX descargado");
    } catch (error) {
      console.error("Error exporting DOCX:", error);
      toast.error("Error al exportar DOCX");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async (doc: ClientDocument) => {
    setIsExporting(true);
    try {
      // Use browser print functionality for secure PDF generation
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error("Por favor permita las ventanas emergentes para exportar PDF");
        setIsExporting(false);
        return;
      }
      
      const fileName = `${DOCUMENT_TYPE_LABELS[doc.document_type]}_${clientName.replace(/\s+/g, "_")}_${format(new Date(doc.created_at), "dd-MM-yyyy")}`;
      
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
        <body>${doc.document_content.replace(/\n/g, '<br>')}</body>
        </html>
      `);
      printWindow.document.close();
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        printWindow.print();
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Historial de Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!documents || documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay documentos generados</p>
              <p className="text-sm">Los documentos guardados aparecerán aquí</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {DOCUMENT_TYPE_LABELS[doc.document_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(doc.created_at), "PPP 'a las' HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setSelectedDocument(doc)}
                            title="Ver documento"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleCopyText(doc.document_content)}
                            title="Copiar texto"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleExportDocx(doc)}
                            disabled={isExporting}
                            title="Descargar DOCX"
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleExportPdf(doc)}
                            disabled={isExporting}
                            title="Descargar PDF"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(doc.id)}
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Document Preview Dialog */}
      <Dialog open={!!selectedDocument} onOpenChange={() => setSelectedDocument(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDocument && (
                <>
                  <Badge variant="outline">
                    {DOCUMENT_TYPE_LABELS[selectedDocument.document_type]}
                  </Badge>
                  <span className="text-muted-foreground text-sm font-normal">
                    {format(new Date(selectedDocument.created_at), "PPP", { locale: es })}
                  </span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] border rounded-md p-4 bg-muted/30">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
              {selectedDocument?.document_content}
            </pre>
          </ScrollArea>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => selectedDocument && handleCopyText(selectedDocument.document_content)}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copiar
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedDocument && handleExportDocx(selectedDocument)}
              disabled={isExporting}
            >
              <FileDown className="h-4 w-4 mr-2" />
              DOCX
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedDocument && handleExportPdf(selectedDocument)}
              disabled={isExporting}
            >
              <Download className="h-4 w-4 mr-2" />
              PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
