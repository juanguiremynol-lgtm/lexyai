import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  FileText,
  Calendar as CalendarIcon,
  Download,
  ExternalLink,
  Folder,
  Clock,
  Filter,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Link } from "react-router-dom";

interface SearchResult {
  id: string;
  type: "document" | "matter_file";
  original_filename: string;
  file_path: string;
  uploaded_at: string;
  kind?: string;
  filing_id?: string;
  matter_id?: string;
  file_size?: number;
  matter_name?: string;
  client_name?: string;
  filing_type?: string;
}

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  DEMANDA: "Demanda",
  ACTA_REPARTO: "Acta de Reparto",
  AUTO_RECEIPT: "Auto de Recibo",
  COURT_RESPONSE: "Respuesta del Juzgado",
  OTHER: "Otro",
};

export default function DocumentSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [isSearching, setIsSearching] = useState(false);

  // Search documents from filings
  const { data: filingDocuments, refetch: refetchFilingDocs } = useQuery({
    queryKey: ["search-filing-documents", searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("documents")
        .select(`
          id,
          original_filename,
          file_path,
          uploaded_at,
          kind,
          filing_id,
          filing:filings(
            filing_type,
            matter:matters(
              matter_name,
              client_name
            )
          )
        `)
        .order("uploaded_at", { ascending: false })
        .limit(100);

      if (searchQuery.trim()) {
        query = query.ilike("original_filename", `%${searchQuery.trim()}%`);
      }

      if (dateFrom) {
        query = query.gte("uploaded_at", dateFrom.toISOString());
      }

      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte("uploaded_at", endOfDay.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((doc): SearchResult => {
        const filing = doc.filing as { 
          filing_type: string; 
          matter: { matter_name: string; client_name: string } | null 
        } | null;
        
        return {
          id: doc.id,
          type: "document",
          original_filename: doc.original_filename,
          file_path: doc.file_path,
          uploaded_at: doc.uploaded_at,
          kind: doc.kind,
          filing_id: doc.filing_id,
          matter_name: filing?.matter?.matter_name,
          client_name: filing?.matter?.client_name,
          filing_type: filing?.filing_type,
        };
      });
    },
    enabled: false,
  });

  // Search matter files
  const { data: matterFiles, refetch: refetchMatterFiles } = useQuery({
    queryKey: ["search-matter-files", searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from("matter_files")
        .select(`
          id,
          original_filename,
          file_path,
          uploaded_at,
          file_size,
          matter_id,
          matter:matters(
            matter_name,
            client_name
          )
        `)
        .order("uploaded_at", { ascending: false })
        .limit(100);

      if (searchQuery.trim()) {
        query = query.ilike("original_filename", `%${searchQuery.trim()}%`);
      }

      if (dateFrom) {
        query = query.gte("uploaded_at", dateFrom.toISOString());
      }

      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte("uploaded_at", endOfDay.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((file): SearchResult => {
        const matter = file.matter as { matter_name: string; client_name: string } | null;
        
        return {
          id: file.id,
          type: "matter_file",
          original_filename: file.original_filename,
          file_path: file.file_path,
          uploaded_at: file.uploaded_at,
          file_size: file.file_size,
          matter_id: file.matter_id,
          matter_name: matter?.matter_name,
          client_name: matter?.client_name,
        };
      });
    },
    enabled: false,
  });

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      await Promise.all([refetchFilingDocs(), refetchMatterFiles()]);
    } finally {
      setIsSearching(false);
    }
  };

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
    } catch {
      toast.error("Error al descargar el archivo");
    }
  };

  const handleOpenInNewTab = async (filePath: string) => {
    try {
      const { data, error } = await supabase.storage
        .from("lexdocket")
        .createSignedUrl(filePath, 3600);

      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch {
      toast.error("Error al abrir el archivo");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDateFrom(undefined);
    setDateTo(undefined);
    setSourceFilter("all");
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  // Combine and filter results
  const allResults = [
    ...(filingDocuments || []),
    ...(matterFiles || []),
  ]
    .filter((result) => {
      if (sourceFilter === "all") return true;
      if (sourceFilter === "filings") return result.type === "document";
      if (sourceFilter === "matters") return result.type === "matter_file";
      return true;
    })
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());

  const hasFilters = searchQuery || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold">Búsqueda de Documentos</h1>
        <p className="text-muted-foreground">
          Buscar archivos en todos los asuntos y radicaciones
        </p>
      </div>

      {/* Search Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros de Búsqueda
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Filename Search */}
            <div className="md:col-span-2 space-y-2">
              <Label>Nombre del archivo</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por nombre..."
                  className="pl-9"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>

            {/* Date From */}
            <div className="space-y-2">
              <Label>Fecha desde</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(dateFrom, "PPP", { locale: es }) : "Seleccionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Date To */}
            <div className="space-y-2">
              <Label>Fecha hasta</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(dateTo, "PPP", { locale: es }) : "Seleccionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Source Filter */}
            <div className="space-y-2">
              <Label>Origen</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="filings">Documentos de Radicaciones</SelectItem>
                  <SelectItem value="matters">Archivos de Asuntos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1" />

            {hasFilters && (
              <Button variant="ghost" onClick={clearFilters} className="gap-1">
                <X className="h-4 w-4" />
                Limpiar
              </Button>
            )}

            <Button onClick={handleSearch} disabled={isSearching} className="gap-2">
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Resultados
            </span>
            {allResults.length > 0 && (
              <Badge variant="secondary">{allResults.length} archivos</Badge>
            )}
          </CardTitle>
          {allResults.length === 0 && (filingDocuments || matterFiles) && (
            <CardDescription>
              No se encontraron archivos con los filtros actuales
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!filingDocuments && !matterFiles ? (
            <div className="text-center py-12">
              <Search className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">
                Ingrese criterios de búsqueda y haga clic en "Buscar"
              </p>
            </div>
          ) : allResults.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">
                No se encontraron documentos
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allResults.map((result) => (
                <div
                  key={`${result.type}-${result.id}`}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p
                        className="font-medium truncate cursor-pointer hover:text-primary"
                        onClick={() => handleOpenInNewTab(result.file_path)}
                        title="Abrir archivo"
                      >
                        {result.original_filename}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <Badge variant={result.type === "document" ? "default" : "secondary"} className="text-xs">
                          {result.type === "document" ? "Radicación" : "Asunto"}
                        </Badge>
                        {result.kind && (
                          <Badge variant="outline" className="text-xs">
                            {DOCUMENT_KIND_LABELS[result.kind] || result.kind}
                          </Badge>
                        )}
                        {result.matter_name && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Folder className="h-3 w-3" />
                            {result.matter_name}
                          </span>
                        )}
                        {result.client_name && (
                          <span className="text-xs text-muted-foreground">
                            • {result.client_name}
                          </span>
                        )}
                        {result.file_size && (
                          <span className="text-xs text-muted-foreground">
                            • {formatFileSize(result.file_size)}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateColombia(result.uploaded_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {result.filing_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                        title="Ver radicación"
                      >
                        <Link to={`/filings/${result.filing_id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleDownload(result.file_path, result.original_filename)}
                      title="Descargar"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
