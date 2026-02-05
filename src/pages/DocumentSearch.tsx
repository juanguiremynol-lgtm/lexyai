import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, FileText } from "lucide-react";
import { formatDateColombia } from "@/lib/constants";
import { Link } from "react-router-dom";

interface DocumentResult {
  id: string;
  kind: string;
  original_filename: string;
  uploaded_at: string;
  file_path: string;
  filing_id: string | null;
}

export default function DocumentSearch() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: documents, isLoading } = useQuery({
    queryKey: ["document-search", searchTerm],
    queryFn: async () => {
      let query = supabase
        .from("documents")
        .select("id, kind, original_filename, uploaded_at, file_path, filing_id")
        .order("uploaded_at", { ascending: false })
        .limit(50);

      if (searchTerm) {
        query = query.ilike("original_filename", `%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as DocumentResult[];
    },
    enabled: true,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">Búsqueda de Documentos</h1>
        <p className="text-muted-foreground">Busca documentos en todos tus trámites</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre de archivo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => setSearchTerm("")}>
          Limpiar
        </Button>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <p className="text-muted-foreground text-center py-8">Buscando...</p>
        ) : !documents?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No se encontraron documentos</p>
          </div>
        ) : (
          documents.map((doc) => (
            <Card key={doc.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {doc.original_filename}
                  </CardTitle>
                  <Badge variant="outline">{doc.kind}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    <p>Subido: {formatDateColombia(new Date(doc.uploaded_at))}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
