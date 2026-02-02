/**
 * Estados de Hoy - Panel de Novedades
 * 
 * CRITICAL ARCHITECTURE:
 * - Estados tab: ONLY work_item_publicaciones data
 * - Actuaciones tab: ONLY work_item_acts data
 * - "New" detection uses fecha_fijacion (estados) and act_date (actuaciones), NOT created_at
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePublicacionesHoy, type PublicacionHoyItem } from "@/hooks/use-publicaciones-hoy";
import { useActuacionesHoy, type ActuacionHoyItem } from "@/hooks/use-actuaciones-hoy";

// UI Components
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// Icons
import {
  Download,
  RefreshCw,
  ExternalLink,
  FileText,
  AlertTriangle,
  Newspaper,
  Scale,
  Clock,
  CheckCircle,
  FileWarning,
  Gavel,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

// ============= CONSTANTS =============

/**
 * Source field semantics:
 * - cpnu, samai, tutelas: Data from external judicial APIs
 * - publicaciones: Data from Publicaciones Procesales API
 * - icarus_import: Legacy data imported from ICARUS system
 * - legacy_import: Historical data with unknown original source
 * - manual: Manually entered by user (rare)
 */
const SOURCE_LABELS: Record<string, string> = {
  // Publicaciones
  publicaciones: "Publicaciones",
  "publicaciones-procesales": "Publicaciones",
  // Actuaciones providers
  cpnu: "CPNU",
  CPNU: "CPNU",
  samai: "SAMAI",
  SAMAI: "SAMAI",
  tutelas: "Tutelas",
  TUTELAS: "Tutelas",
  // Legacy/Import sources
  icarus_import: "ICARUS",
  ICARUS_ESTADOS: "ICARUS",
  legacy_import: "Importación",
  manual: "Manual",
  MANUAL: "Manual",
};

// ============= HELPER FUNCTIONS =============

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return format(new Date(dateStr), "dd/MM/yyyy", { locale: es });
  } catch {
    return dateStr;
  }
}

// ============= PUBLICACIONES TABLE COMPONENT =============

function PublicacionesTable({ 
  items, 
  isLoading, 
  title,
  showNoDateWarning = false,
  onRowClick,
}: { 
  items: PublicacionHoyItem[];
  isLoading: boolean;
  title: string;
  showNoDateWarning?: boolean;
  onRowClick: (item: PublicacionHoyItem) => void;
}) {
  return (
    <div className="space-y-3">
      {showNoDateWarning && items.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <FileWarning className="h-4 w-4 flex-shrink-0" />
          <span>
            Estos estados no tienen fecha de fijación en el PDF. Se muestran porque fueron sincronizados en las últimas 24 horas.
          </span>
        </div>
      )}
      
      {title && items.length > 0 && (
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      )}
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">PDF</TableHead>
              <TableHead>Título</TableHead>
              <TableHead className="w-[180px]">Radicado</TableHead>
              <TableHead>Juzgado</TableHead>
              <TableHead className="w-[120px]">Fecha fijación</TableHead>
              <TableHead className="w-[120px]">Inicia término</TableHead>
              <TableHead className="w-[80px]">Fuente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Newspaper className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No hay estados nuevos en los últimos 3 días</p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50 transition-colors",
                    item.is_in_ejecutoria_window && "bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50"
                  )}
                  onClick={() => onRowClick(item)}
                >
                  {/* PDF Link */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {item.pdf_url || item.entry_url ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        asChild
                      >
                        <a href={item.pdf_url || item.entry_url || ''} target="_blank" rel="noopener noreferrer">
                          <FileText className="h-4 w-4 text-primary" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  
                  {/* Title */}
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[200px]">{item.title}</span>
                      {item.is_in_ejecutoria_window && (
                        <Badge variant="outline" className="text-green-600 border-green-300 text-xs">
                          En ejecutoria
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  
                  {/* Radicado */}
                  <TableCell className="font-mono text-xs">
                    {item.radicado || "—"}
                  </TableCell>
                  
                  {/* Authority/Court */}
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {item.authority_name || item.despacho || "—"}
                  </TableCell>
                  
                  {/* Fecha fijación */}
                  <TableCell>
                    {item.fecha_fijacion ? (
                      <span className="text-sm">{formatDate(item.fecha_fijacion)}</span>
                    ) : (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Sin fecha
                      </span>
                    )}
                  </TableCell>
                  
                  {/* Inicia término */}
                  <TableCell>
                    {item.terminos_inician ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className={cn(
                                "text-sm",
                                item.is_in_ejecutoria_window && "font-medium text-green-700 dark:text-green-400"
                              )}>
                                {formatDate(item.terminos_inician)}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Día hábil siguiente a la desfijación</p>
                            {item.ejecutoria_ends_at && (
                              <p className="text-green-600">
                                Ejecutoria hasta: {formatDate(item.ejecutoria_ends_at)}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  
                  {/* Source */}
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {SOURCE_LABELS[item.source] || item.source}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============= ACTUACIONES TABLE COMPONENT =============

function ActuacionesTable({ 
  items, 
  isLoading,
  onRowClick,
}: { 
  items: ActuacionHoyItem[];
  isLoading: boolean;
  onRowClick: (item: ActuacionHoyItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Actuación</TableHead>
            <TableHead className="w-[180px]">Radicado</TableHead>
            <TableHead>Juzgado</TableHead>
            <TableHead className="w-[120px]">Fecha</TableHead>
            <TableHead className="w-[80px]">Fuente</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 5 }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                <Scale className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No hay actuaciones nuevas en los últimos 3 días</p>
                <p className="text-xs mt-1">Las actuaciones se muestran según su fecha de registro en el juzgado (act_date), no la fecha de sincronización.</p>
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow
                key={item.id}
                className={cn(
                  "cursor-pointer hover:bg-muted/50 transition-colors",
                  item.is_important && "bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                )}
                onClick={() => onRowClick(item)}
              >
                {/* Description */}
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {item.is_important && (
                        <Gavel className="h-4 w-4 text-amber-600 flex-shrink-0" />
                      )}
                      <span className={cn(
                        "font-medium truncate max-w-[300px]",
                        item.is_important && "text-amber-900 dark:text-amber-200"
                      )}>
                        {item.act_type || item.description?.split('.')[0] || 'Actuación'}
                      </span>
                      {item.importance_reason && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                          {item.importance_reason}
                        </Badge>
                      )}
                    </div>
                    {item.description && item.description !== item.act_type && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-xs text-muted-foreground truncate max-w-[400px] italic">
                              "{item.description.substring(0, 80)}{item.description.length > 80 ? '...' : ''}"
                            </p>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-md">
                            <p className="text-sm">{item.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
                
                {/* Radicado */}
                <TableCell className="font-mono text-xs">
                  {item.radicado || "—"}
                </TableCell>
                
                {/* Authority/Court */}
                <TableCell className="text-sm max-w-[200px] truncate">
                  {item.authority_name || item.despacho || "—"}
                </TableCell>
                
                {/* Date */}
                <TableCell className="text-sm">
                  {formatDate(item.act_date)}
                </TableCell>
                
                {/* Source */}
                <TableCell>
                  <Badge variant="secondary" className="text-xs uppercase">
                    {SOURCE_LABELS[item.source] || item.source}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ============= MAIN COMPONENT =============

export default function EstadosHoy() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'estados' | 'actuaciones'>('estados');
  
  // Separate data hooks
  const publicaciones = usePublicacionesHoy();
  const actuaciones = useActuacionesHoy();
  
  // Navigation handlers
  const handlePublicacionClick = useCallback((item: PublicacionHoyItem) => {
    navigate(`/app/work-items/${item.work_item_id}`);
  }, [navigate]);
  
  const handleActuacionClick = useCallback((item: ActuacionHoyItem) => {
    navigate(`/app/work-items/${item.work_item_id}`);
  }, [navigate]);
  
  // Refresh handler
  const handleRefresh = useCallback(() => {
    publicaciones.refetch();
    actuaciones.refetch();
    toast.success("Actualizando datos...");
  }, [publicaciones, actuaciones]);
  
  // Export handler
  const handleExport = useCallback(() => {
    const allPublicaciones = [
      ...(publicaciones.data?.withDate || []),
      ...(publicaciones.data?.withoutDate || []),
    ];
    
    if (activeTab === 'estados') {
      if (!allPublicaciones.length) {
        toast.error("No hay estados para exportar");
        return;
      }
      
      const exportData = allPublicaciones.map(item => ({
        "Título": item.title,
        "Radicado": item.radicado || "",
        "Juzgado": item.authority_name || item.despacho || "",
        "Demandante(s)": item.demandantes || "",
        "Demandado(s)": item.demandados || "",
        "Fecha fijación": item.fecha_fijacion || "Sin fecha",
        "Inicia término": item.terminos_inician || "—",
        "En ejecutoria": item.is_in_ejecutoria_window ? "Sí" : "No",
        "PDF URL": item.pdf_url || "",
        "Fuente": SOURCE_LABELS[item.source] || item.source,
      }));
      
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Estados");
      XLSX.writeFile(wb, `estados_hoy_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`);
    } else {
      const items = actuaciones.data?.items || [];
      if (!items.length) {
        toast.error("No hay actuaciones para exportar");
        return;
      }
      
      const exportData = items.map(item => ({
        "Actuación": item.description,
        "Radicado": item.radicado || "",
        "Juzgado": item.authority_name || item.despacho || "",
        "Demandante(s)": item.demandantes || "",
        "Demandado(s)": item.demandados || "",
        "Fecha": item.act_date || "",
        "Importante": item.is_important ? "Sí" : "No",
        "Motivo importancia": item.importance_reason || "",
        "Fuente": SOURCE_LABELS[item.source] || item.source,
      }));
      
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Actuaciones");
      XLSX.writeFile(wb, `actuaciones_hoy_${format(new Date(), 'yyyy-MM-dd_HHmm')}.xlsx`);
    }
    
    toast.success("Archivo exportado exitosamente");
  }, [activeTab, publicaciones.data, actuaciones.data]);
  
  const isFetching = publicaciones.isFetching || actuaciones.isFetching;
  
  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Panel de Novedades</h1>
          <p className="text-muted-foreground">
            Estados y actuaciones judiciales de los últimos 3 días
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
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
            Los estados permanecerán sombreados con <strong>verde</strong> durante <strong>3 días hábiles</strong> después de iniciar el término, en virtud de los términos de ejecutoria.
          </p>
        </CardContent>
      </Card>
      
      {/* Tabs */}
      <Card>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'estados' | 'actuaciones')}>
          <CardHeader className="pb-0">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="estados" className="gap-2">
                <Newspaper className="h-4 w-4" />
                Estados
                <Badge variant={activeTab === 'estados' ? 'default' : 'secondary'} className="ml-1">
                  {publicaciones.totalCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="actuaciones" className="gap-2">
                <Scale className="h-4 w-4" />
                Actuaciones
                <Badge variant={activeTab === 'actuaciones' ? 'default' : 'secondary'} className="ml-1">
                  {actuaciones.totalCount}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          
          <CardContent className="pt-6">
            {/* Estados Tab */}
            <TabsContent value="estados" className="mt-0 space-y-6">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Newspaper className="h-4 w-4" />
                <span>
                  Publicaciones procesales de la Rama Judicial (últimos 3 días por fecha de fijación)
                </span>
              </div>
              
              {/* With date */}
              {(publicaciones.data?.withDate?.length || 0) > 0 && (
                <PublicacionesTable
                  items={publicaciones.data?.withDate || []}
                  isLoading={publicaciones.isLoading}
                  title="Con fecha de fijación"
                  onRowClick={handlePublicacionClick}
                />
              )}
              
              {/* Without date */}
              {(publicaciones.data?.withoutDate?.length || 0) > 0 && (
                <PublicacionesTable
                  items={publicaciones.data?.withoutDate || []}
                  isLoading={publicaciones.isLoading}
                  title="Sin fecha de fijación (sincronizados hoy)"
                  showNoDateWarning={true}
                  onRowClick={handlePublicacionClick}
                />
              )}
              
              {/* Empty state */}
              {!publicaciones.isLoading && publicaciones.totalCount === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Newspaper className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">No hay estados nuevos en los últimos 3 días</p>
                  <p className="text-sm mt-1">
                    Los estados se muestran según su fecha de fijación, no la fecha de sincronización.
                  </p>
                </div>
              )}
            </TabsContent>
            
            {/* Actuaciones Tab */}
            <TabsContent value="actuaciones" className="mt-0 space-y-4">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Scale className="h-4 w-4" />
                <span>
                  Actuaciones del libro del juzgado (últimos 3 días por fecha de actuación)
                </span>
              </div>
              
              <ActuacionesTable
                items={actuaciones.data?.items || []}
                isLoading={actuaciones.isLoading}
                onRowClick={handleActuacionClick}
              />
              
              {actuaciones.importantCount > 0 && (
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <Gavel className="h-4 w-4" />
                  <span>{actuaciones.importantCount} actuaciones importantes destacadas</span>
                </div>
              )}
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
      
      {/* Footer info */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>
          Los datos se actualizan automáticamente al iniciar sesión y diariamente a las 7:00 AM.
        </p>
        <p>
          <strong>Estados:</strong> Filtrados por fecha de fijación (fecha_fijacion) • 
          <strong> Actuaciones:</strong> Filtradas por fecha de actuación (act_date)
        </p>
      </div>
    </div>
  );
}
