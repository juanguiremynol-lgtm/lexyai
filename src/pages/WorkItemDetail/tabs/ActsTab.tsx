/**
 * Acts Tab - Shows actuaciones for the work item with ALL SAMAI fields
 * Displays complete information as received from the external API without summarizing
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { 
  Scale, 
  Calendar,
  Clock,
  FileText,
  ExternalLink,
  Paperclip,
  Hash,
  CheckCircle2,
  AlertCircle,
  Archive,
  Tag,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

import type { WorkItem } from "@/types/work-item";

interface ActsTabProps {
  workItem: WorkItem & { _source?: string };
}

// Estado badge styling based on SAMAI states
const ESTADO_CONFIG: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof CheckCircle2; color: string }> = {
  REGISTRADA: { variant: "secondary", icon: CheckCircle2, color: "text-blue-600" },
  CLASIFICADA: { variant: "default", icon: Archive, color: "text-green-600" },
  PENDIENTE: { variant: "outline", icon: AlertCircle, color: "text-amber-600" },
};

// Act type styling based on common patterns
const ACT_TYPE_CONFIG: Record<string, { color: string; bgColor: string }> = {
  AUTO_ADMISORIO: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  "AUTO ADMISORIO": { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  ADMITE: { color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  FALLO: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  SENTENCIA: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  NOTIFICACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  "FIJACION ESTADO": { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  FIJACION: { color: "text-amber-600", bgColor: "bg-amber-500/10" },
  AUDIENCIA: { color: "text-purple-600", bgColor: "bg-purple-500/10" },
  MEMORIAL: { color: "text-indigo-600", bgColor: "bg-indigo-500/10" },
  TRASLADO: { color: "text-cyan-600", bgColor: "bg-cyan-500/10" },
  RECURSO: { color: "text-orange-600", bgColor: "bg-orange-500/10" },
  REPARTO: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  RADICACION: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  EXPEDIENTE: { color: "text-slate-600", bgColor: "bg-slate-500/10" },
  "EXPEDIENTE DIGITAL": { color: "text-slate-600", bgColor: "bg-slate-500/10" },
  DEFAULT: { color: "text-muted-foreground", bgColor: "bg-muted/50" },
};

interface Attachment {
  nombre?: string;
  url?: string;
  label?: string;
  name?: string;
}

interface Actuacion {
  id: string;
  owner_id: string;
  work_item_id: string | null;
  // Core actuación data - display ALL exactly as received
  act_date: string | null;           // fechaActuacion from CPNU/SAMAI
  act_date_raw: string | null;       // Original date string
  act_time: string | null;           // Time component if available
  raw_text: string;                  // "actuacion" field - the main title
  normalized_text: string;           // "anotacion" field - detailed notes
  act_type_guess: string | null;     // Classified type
  // CPNU/SAMAI-specific fields
  fecha_registro: string | null;     // fechaRegistro 
  estado: string | null;             // Estado (REGISTRADA, CLASIFICADA, etc)
  anexos_count: number | null;       // Number of attachments
  indice: string | null;             // Index number
  attachments: Attachment[] | null;  // Document attachments (CPNU documentos / SAMAI anexos)
  // Source tracking
  source: string;
  source_url: string | null;
  adapter_name: string | null;
  hash_fingerprint: string;
  created_at: string;
}

export function ActsTab({ workItem }: ActsTabProps) {
  const { data: acts, isLoading } = useQuery({
    queryKey: ["work-item-actuaciones", workItem.id],
    queryFn: async () => {
      console.log("[ActsTab] Fetching actuaciones for work_item:", workItem.id);
      
      const { data: actuaciones, error } = await supabase
        .from("actuaciones")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("act_date", { ascending: false, nullsFirst: false });
      
      if (error) {
        console.error("[ActsTab] Error fetching actuaciones:", error);
        throw error;
      }
      
      console.log("[ActsTab] Fetched actuaciones:", actuaciones?.length);
      return (actuaciones || []) as Actuacion[];
    },
    enabled: !!workItem.id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const getActTypeConfig = (rawText: string) => {
    const searchText = (rawText || '').toUpperCase();
    for (const [key, config] of Object.entries(ACT_TYPE_CONFIG)) {
      if (key !== 'DEFAULT' && searchText.includes(key)) return config;
    }
    return ACT_TYPE_CONFIG.DEFAULT;
  };

  const getEstadoConfig = (estado: string | null) => {
    if (!estado) return null;
    return ESTADO_CONFIG[estado.toUpperCase()] || ESTADO_CONFIG.PENDIENTE;
  };

  // Parse CPNU/SAMAI date format: "06/05/2025 15:11:01" or "06/05/2025" or "2025-01-21"
  const parseAndFormatDate = (dateStr: string | null, includeTime = false) => {
    if (!dateStr) return null;
    
    try {
      // Handle DD/MM/YYYY format
      const parts = dateStr.split(' ');
      const dateParts = parts[0].split('/');
      
      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);
        
        let hours = 0, minutes = 0, seconds = 0;
        if (parts[1]) {
          const timeParts = parts[1].split(':');
          hours = parseInt(timeParts[0] || '0', 10);
          minutes = parseInt(timeParts[1] || '0', 10);
          seconds = parseInt(timeParts[2] || '0', 10);
        }
        
        const date = new Date(year, month, day, hours, minutes, seconds);
        if (isNaN(date.getTime())) return dateStr;
        
        if (includeTime && parts[1]) {
          return format(date, "d MMM yyyy, HH:mm:ss", { locale: es });
        }
        return format(date, "d MMM yyyy", { locale: es });
      }
      
      // Fallback: try parsing as ISO or standard date
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return format(date, "d MMM yyyy", { locale: es });
    } catch {
      return dateStr;
    }
  };

  // Extract date from normalized_text if act_date is null (legacy data)
  // Pattern: "Registrada el DD/MM/YYYY" or "el DD/MM/YYYY a las HH:MM:SS"
  const extractDateFromText = (text: string | null): string | null => {
    if (!text) return null;
    
    // Match patterns like "18/11/2025" or "21/01/2026"
    const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      return dateMatch[1];
    }
    
    // Match ISO date patterns like "2025-01-21"
    const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      return isoMatch[1];
    }
    
    return null;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!acts || acts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Sin actuaciones registradas</h3>
            <p className="text-muted-foreground text-sm">
              Las actuaciones aparecerán aquí cuando se sincronicen desde la Rama Judicial
              o se registren manualmente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card with count */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Actuaciones
            <Badge variant="secondary" className="ml-auto">
              {acts.length} {acts.length === 1 ? 'actuación' : 'actuaciones'}
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Actuaciones List - show ALL fields */}
      <div className="space-y-3">
        {acts.map((act) => {
          const typeConfig = getActTypeConfig(act.raw_text);
          const estadoConfig = getEstadoConfig(act.estado);
          const EstadoIcon = estadoConfig?.icon || CheckCircle2;

          return (
            <Card key={act.id} className={cn("transition-colors hover:shadow-md", typeConfig.bgColor)}>
              <CardContent className="p-4">
                {/* Row 1: Index, Type, Estado, Anexos, Source */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {/* Índice (order number) */}
                  {act.indice && (
                    <Badge variant="outline" className="text-xs font-mono gap-1 bg-background">
                      <Hash className="h-3 w-3" />
                      {act.indice}
                    </Badge>
                  )}
                  
                  {/* Act type (from raw_text classification) */}
                  {act.act_type_guess && (
                    <Badge variant="outline" className={cn("text-xs font-medium", typeConfig.color)}>
                      <Tag className="h-3 w-3 mr-1" />
                      {act.act_type_guess}
                    </Badge>
                  )}
                  
                  {/* Estado from SAMAI */}
                  {act.estado && estadoConfig && (
                    <Badge variant={estadoConfig.variant} className={cn("text-xs gap-1", estadoConfig.color)}>
                      <EstadoIcon className="h-3 w-3" />
                      {act.estado}
                    </Badge>
                  )}
                  
                  {/* Anexos count */}
                  {act.anexos_count !== null && act.anexos_count > 0 && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Paperclip className="h-3 w-3" />
                      {act.anexos_count} {act.anexos_count === 1 ? 'anexo' : 'anexos'}
                    </Badge>
                  )}
                  
                  {/* Source adapter */}
                  {act.adapter_name && (
                    <Badge variant="outline" className="text-xs text-muted-foreground ml-auto">
                      {act.adapter_name.toUpperCase()}
                    </Badge>
                  )}
                </div>

                <Separator className="mb-3" />

                {/* Row 2: Main content grid */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                  {/* Left side: Actuación title and Anotación */}
                  <div className="lg:col-span-3 space-y-2">
                    {/* Actuación - the main title/type */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Actuación</p>
                      <p className="font-medium text-sm">{act.raw_text}</p>
                    </div>

                    {/* Anotación - detailed notes (show FULL text, no summarizing) */}
                    {act.normalized_text && act.normalized_text !== act.raw_text && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Anotación</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {/* Remove redundant prefix if present */}
                          {act.normalized_text.startsWith(act.raw_text + ' - ') 
                            ? act.normalized_text.replace(act.raw_text + ' - ', '')
                            : act.normalized_text}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right side: Dates */}
                  <div className="space-y-3">
                    {/* Fecha Actuación (main date) */}
                    {act.act_date ? (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Fecha Actuación
                        </p>
                        <p className="text-sm font-medium">
                          {format(new Date(act.act_date), "d MMM yyyy", { locale: es })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(act.act_date), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    ) : (
                      // Fallback: try extracting date from normalized_text for legacy data
                      (() => {
                        const extractedDate = extractDateFromText(act.normalized_text);
                        if (extractedDate) {
                          const formattedDate = parseAndFormatDate(extractedDate);
                          return (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Fecha (extraída)
                              </p>
                              <p className="text-sm text-muted-foreground italic">
                                {formattedDate}
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()
                    )}

                    {/* Fecha Registro (when registered in system) */}
                    {act.fecha_registro && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Fecha Registro
                        </p>
                        <p className="text-sm">
                          {parseAndFormatDate(act.fecha_registro, true) || 
                           format(new Date(act.fecha_registro), "d MMM yyyy, HH:mm", { locale: es })}
                        </p>
                      </div>
                    )}

                    {/* Original date if different (for debugging/verification) */}
                    {act.act_date_raw && act.act_date_raw !== act.act_date && (
                      <div className="text-xs text-muted-foreground italic">
                        <span>Original: {act.act_date_raw}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 3: Attachments (CPNU documentos / SAMAI anexos) */}
                {act.attachments && Array.isArray(act.attachments) && act.attachments.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Documentos adjuntos
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {act.attachments.map((doc, idx) => {
                          const docUrl = doc.url || '';
                          const docName = doc.nombre || doc.name || doc.label || `Documento ${idx + 1}`;
                          return docUrl ? (
                            <a
                              key={idx}
                              href={docUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline bg-primary/5 px-2 py-1 rounded"
                            >
                              <ExternalLink className="h-3 w-3" />
                              {docName}
                            </a>
                          ) : (
                            <span key={idx} className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                              {docName}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {/* Row 4: Source URL if available */}
                {act.source_url && (
                  <>
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Fuente: {act.source}
                      </span>
                      <a
                        href={act.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ver documento
                      </a>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
