/**
 * Estados de Hoy - Global View
 * 
 * ICARUS-style "Estados electrónicos / Estados de hoy" page
 * Shows unified view of all work_item_acts + work_item_publicaciones
 * with 3-business-day ejecutoria highlight.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useOrganization } from "@/contexts/OrganizationContext";
import { 
  getEstadosHoy, 
  type EstadoHoyItem, 
  type EstadosHoyFilters 
} from "@/lib/services/estados-hoy-service";
import { supabase } from "@/integrations/supabase/client";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

// Icons
import {
  Search,
  Download,
  RefreshCw,
  ExternalLink,
  FileText,
  AlertTriangle,
  Info,
  Newspaper,
  Scale,
  Clock,
  CheckCircle,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

// ============= CONSTANTS =============

const PAGE_SIZE = 20;

const SEVERITY_CONFIG = {
  CRITICAL: { label: "Crítico", color: "bg-red-500", textColor: "text-red-600" },
  HIGH: { label: "Alto", color: "bg-orange-500", textColor: "text-orange-600" },
  MEDIUM: { label: "Medio", color: "bg-yellow-500", textColor: "text-yellow-600" },
  LOW: { label: "Bajo", color: "bg-blue-500", textColor: "text-blue-600" },
};

const SOURCE_LABELS: Record<string, string> = {
  PUBLICACIONES_API: "Rama Judicial",
  CPNU: "CPNU",
  SAMAI: "SAMAI",
  ICARUS: "ICARUS",
  MANUAL: "Manual",
};

// ============= COMPONENT =============

export default function EstadosHoy() {
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // State
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showTutelas, setShowTutelas] = useState(true);
  const [showOnlyCritical, setShowOnlyCritical] = useState(false);
  
  // Debounce search
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, []);
  
  // Build filters
  const filters: EstadosHoyFilters = useMemo(() => ({
    search: debouncedSearch,
    showTutelas,
    showOnlyCritical,
  }), [debouncedSearch, showTutelas, showOnlyCritical]);
  
  // Main query
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["estados-hoy", organization?.id, page, filters],
    queryFn: () => getEstadosHoy(organization!.id, { page, pageSize: PAGE_SIZE, filters }),
    enabled: !!organization?.id,
    staleTime: 30000,
  });
  
  // Export to Excel
  const handleExport = useCallback(() => {
    if (!data?.items?.length) {
      toast.error("No hay datos para exportar");
      return;
    }
    
    const exportData = data.items.map(item => ({
      "Número del proceso": item.radicado || "",
      "Despacho": item.despacho || item.authority_name || "",
      "Demandante(s)": item.demandantes || "",
      "Demandado(s)": item.demandados || "",
      "Actuación": item.actuacion_type || item.type,
      "Anotación": item.content || "",
      "Inicia término": item.inicia_termino || "—",
      "Fuente término": item.inicia_termino_source === 'fecha_desfijacion' ? 'Fecha desfijación' 
        : item.inicia_termino_source === 'fecha_inicial_raw' ? 'Fecha inicial (ICARUS)'
        : item.inicia_termino_source === 'fecha_publicacion' ? 'Fecha publicación (fallback)'
        : 'Sin datos',
      "Tipo": item.type === 'ESTADO' ? 'Estado' : 'Actuación',
      "Severidad": SEVERITY_CONFIG[item.severity]?.label || item.severity,
      "Fuente": SOURCE_LABELS[item.source] || item.source,
      "Fecha": item.date || "",
      "En ejecutoria": item.is_in_ejecutoria_window ? 'Sí' : 'No',
    }));
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estados de Hoy");
    XLSX.writeFile(wb, `estados_hoy_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`);
    
    toast.success("Archivo exportado exitosamente");
  }, [data?.items]);
  
  // Navigate to work item detail
  const handleRowClick = (item: EstadoHoyItem) => {
    navigate(`/app/work-items/${item.work_item_id}`);
  };
  
  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd/MM/yyyy", { locale: es });
    } catch {
      return dateStr;
    }
  };
  
  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estados de Hoy</h1>
          <p className="text-muted-foreground">
            Vista global de estados y actuaciones judiciales
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!data?.items?.length}
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </div>
      
      {/* Ejecutoria Banner */}
      <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
        <CardContent className="py-3 flex items-center gap-3">
          <div className="h-6 w-6 rounded-full bg-green-500/20 flex items-center justify-center">
            <CheckCircle className="h-4 w-4 text-green-600" />
          </div>
          <p className="text-sm text-green-800 dark:text-green-200">
            Los estados permanecerán sombreados con <strong>verde</strong> durante <strong>3 días hábiles</strong>, en virtud de los términos de ejecutoria.
          </p>
        </CardContent>
      </Card>
      
      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            {/* Search */}
            <div className="flex-1">
              <Label htmlFor="search" className="text-sm mb-1.5 block">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Radicado, despacho, partes, anotación..."
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            {/* Toggles */}
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="tutelas"
                  checked={showTutelas}
                  onCheckedChange={(checked) => {
                    setShowTutelas(checked);
                    setPage(1);
                  }}
                />
                <Label htmlFor="tutelas" className="text-sm cursor-pointer">
                  Mostrar tutelas
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="critical"
                  checked={showOnlyCritical}
                  onCheckedChange={(checked) => {
                    setShowOnlyCritical(checked);
                    setPage(1);
                  }}
                />
                <Label htmlFor="critical" className="text-sm cursor-pointer">
                  Solo críticos
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Results count */}
      {data && (
        <div className="text-sm text-muted-foreground">
          Mostrando {data.items.length} de {data.total} resultados
          {debouncedSearch && ` para "${debouncedSearch}"`}
        </div>
      )}
      
      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Número del proceso</TableHead>
                <TableHead>Despacho</TableHead>
                <TableHead>Demandante(s)</TableHead>
                <TableHead>Demandado(s)</TableHead>
                <TableHead>Actuación</TableHead>
                <TableHead className="max-w-[200px]">Anotación</TableHead>
                <TableHead>Inicia término</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data?.items?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    No se encontraron estados o actuaciones
                  </TableCell>
                </TableRow>
              ) : (
                data?.items?.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-colors",
                      item.is_in_ejecutoria_window && "bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50"
                    )}
                    onClick={() => handleRowClick(item)}
                  >
                    {/* Radicado */}
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "h-2 w-2 rounded-full",
                          SEVERITY_CONFIG[item.severity]?.color
                        )} />
                        <span>{item.radicado || "—"}</span>
                      </div>
                    </TableCell>
                    
                    {/* Despacho */}
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {item.despacho || item.authority_name || "—"}
                    </TableCell>
                    
                    {/* Demandantes */}
                    <TableCell className="text-sm max-w-[150px] truncate">
                      {item.demandantes || item.client_name || "—"}
                    </TableCell>
                    
                    {/* Demandados */}
                    <TableCell className="text-sm max-w-[150px] truncate">
                      {item.demandados || "—"}
                    </TableCell>
                    
                    {/* Actuación */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {item.type === 'ESTADO' ? 'EST' : 'ACT'}
                        </Badge>
                        <span className="text-sm">{item.actuacion_type || "—"}</span>
                      </div>
                    </TableCell>
                    
                    {/* Anotación */}
                    <TableCell className="max-w-[200px]">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm truncate block">
                              {item.content?.substring(0, 50) || "—"}
                              {item.content && item.content.length > 50 && "..."}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-sm">
                            <p className="text-sm">{item.content}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    
                    {/* Inicia término */}
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              {item.inicia_termino ? (
                                <>
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className={cn(
                                    "text-sm",
                                    item.is_in_ejecutoria_window && "font-medium text-green-700 dark:text-green-400"
                                  )}>
                                    {formatDate(item.inicia_termino)}
                                  </span>
                                </>
                              ) : (
                                <div className="flex items-center gap-1 text-amber-600">
                                  <AlertTriangle className="h-3 w-3" />
                                  <span className="text-xs">Sin datos</span>
                                </div>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {item.inicia_termino_source === 'fecha_desfijacion' && (
                              <p>Desde fecha_desfijacion (Publicaciones)</p>
                            )}
                            {item.inicia_termino_source === 'fecha_inicial_raw' && (
                              <p>Desde fechaInicial (ICARUS/Actuaciones)</p>
                            )}
                            {item.inicia_termino_source === 'fecha_publicacion' && (
                              <p>Calculado desde fecha publicación (fallback)</p>
                            )}
                            {item.inicia_termino_source === 'none' && (
                              <p>Sin datos de término disponibles</p>
                            )}
                            {item.is_in_ejecutoria_window && item.ejecutoria_ends_at && (
                              <p className="text-green-600 mt-1">
                                Ejecutoria hasta: {formatDate(item.ejecutoria_ends_at)}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    
                    {/* Actions - PDF link only, no sync button */}
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {item.pdf_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            asChild
                          >
                            <a href={item.pdf_url} target="_blank" rel="noopener noreferrer">
                              <FileText className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
      
      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            
            {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    onClick={() => setPage(pageNum)}
                    isActive={page === pageNum}
                    className="cursor-pointer"
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                className={page === data.totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
