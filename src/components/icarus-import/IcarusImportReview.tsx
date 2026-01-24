/**
 * ICARUS Import Review Component
 * 
 * Combined classification + client linking review before import.
 * Each row can be classified AND linked to a client independently.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Filter,
  Sparkles,
  Scale,
  Landmark,
  Gavel,
  HelpCircle,
  Users,
  UserPlus,
  Link as LinkIcon,
  Loader2,
} from "lucide-react";
import type { IcarusExcelRow } from "@/lib/icarus-excel-parser";
import {
  detectWorkflowType,
  type SuggestedWorkflowType,
} from "@/lib/icarus-workflow-detection";
import { findBestClientMatch, type ClientMatchResult } from "@/lib/client-matching";

// Extended row type with classification AND client linking
export interface ReviewedRow extends IcarusExcelRow {
  rowIndex: number;
  suggestedType: SuggestedWorkflowType;
  selectedType: SuggestedWorkflowType | null;
  wasTypeOverridden: boolean;
  matchedKeywords: string[];
  suggestedClientId: string | null;
  suggestedClientName: string | null;
  suggestedClientScore: number | null;
  selectedClientId: string | null;
  wasClientOverridden: boolean;
}

interface IcarusImportReviewProps {
  rows: IcarusExcelRow[];
  selectedRowIndices: Set<number>;
  onRowsReviewed: (reviewedRows: ReviewedRow[]) => void;
  onCancel: () => void;
  isImporting: boolean;
}

const ALLOWED_TYPES: SuggestedWorkflowType[] = ['CGP', 'CPACA', 'TUTELA'];

const TYPE_ICONS: Record<SuggestedWorkflowType, React.ReactNode> = {
  CGP: <Scale className="h-4 w-4" />,
  CPACA: <Landmark className="h-4 w-4" />,
  TUTELA: <Gavel className="h-4 w-4" />,
  UNKNOWN: <HelpCircle className="h-4 w-4" />,
};

const TYPE_LABELS: Record<SuggestedWorkflowType, string> = {
  CGP: 'CGP',
  CPACA: 'CPACA',
  TUTELA: 'Tutela',
  UNKNOWN: 'Sin clasificar',
};

const TYPE_COLORS: Record<SuggestedWorkflowType, string> = {
  CGP: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300',
  CPACA: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300',
  TUTELA: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

export function IcarusImportReview({
  rows,
  selectedRowIndices,
  onRowsReviewed,
  onCancel,
  isImporting,
}: IcarusImportReviewProps) {
  // Fetch clients for matching and selection
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Initialize reviewed rows with auto-detection for both type AND client
  const [reviewedRows, setReviewedRows] = useState<ReviewedRow[]>([]);
  
  // Initialize once clients are loaded
  useEffect(() => {
    if (clientsLoading) return;
    
    const initialRows = rows
      .filter((_, idx) => selectedRowIndices.has(idx))
      .map((row, i) => {
        const detection = detectWorkflowType(row.despacho);
        const originalIndex = Array.from(selectedRowIndices)[i];
        
        // Try to match client
        const clientMatch = findBestClientMatch(
          clients,
          row.demandantes,
          row.demandados,
          0.6
        );
        
        return {
          ...row,
          rowIndex: originalIndex,
          suggestedType: detection.suggestedType,
          selectedType: detection.suggestedType !== 'UNKNOWN' ? detection.suggestedType : null,
          wasTypeOverridden: false,
          matchedKeywords: detection.matchedKeywords,
          suggestedClientId: clientMatch?.clientId || null,
          suggestedClientName: clientMatch?.clientName || null,
          suggestedClientScore: clientMatch?.score || null,
          selectedClientId: clientMatch?.clientId || null,
          wasClientOverridden: false,
        };
      });
    
    setReviewedRows(initialRows);
  }, [rows, selectedRowIndices, clients, clientsLoading]);

  const [selectedForBulk, setSelectedForBulk] = useState<Set<number>>(new Set());
  const [filterType, setFilterType] = useState<SuggestedWorkflowType | 'ALL'>('ALL');
  const [showOnlyUnclassified, setShowOnlyUnclassified] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const total = reviewedRows.length;
    const classified = reviewedRows.filter(r => r.selectedType !== null).length;
    const unclassified = total - classified;
    const byType = ALLOWED_TYPES.reduce((acc, type) => {
      acc[type] = reviewedRows.filter(r => r.selectedType === type).length;
      return acc;
    }, {} as Record<string, number>);
    const autoSuggested = reviewedRows.filter(r => r.suggestedType !== 'UNKNOWN').length;
    const typeOverridden = reviewedRows.filter(r => r.wasTypeOverridden).length;
    const withClient = reviewedRows.filter(r => r.selectedClientId !== null).length;
    const clientAutoSuggested = reviewedRows.filter(r => r.suggestedClientId !== null).length;
    
    return { total, classified, unclassified, byType, autoSuggested, typeOverridden, withClient, clientAutoSuggested };
  }, [reviewedRows]);

  // Filtered rows for display
  const displayRows = useMemo(() => {
    let filtered = reviewedRows;
    
    if (filterType !== 'ALL') {
      filtered = filtered.filter(r => r.selectedType === filterType || r.suggestedType === filterType);
    }
    
    if (showOnlyUnclassified) {
      filtered = filtered.filter(r => r.selectedType === null);
    }
    
    return filtered;
  }, [reviewedRows, filterType, showOnlyUnclassified]);

  // Handle single row type change
  const handleRowTypeChange = useCallback((rowIndex: number, newType: SuggestedWorkflowType) => {
    setReviewedRows(prev => prev.map(row => {
      if (row.rowIndex === rowIndex) {
        return {
          ...row,
          selectedType: newType,
          wasTypeOverridden: newType !== row.suggestedType,
        };
      }
      return row;
    }));
  }, []);

  // Handle single row client change
  const handleRowClientChange = useCallback((rowIndex: number, clientId: string | null) => {
    setReviewedRows(prev => prev.map(row => {
      if (row.rowIndex === rowIndex) {
        return {
          ...row,
          selectedClientId: clientId,
          wasClientOverridden: clientId !== row.suggestedClientId,
        };
      }
      return row;
    }));
  }, []);

  // Handle bulk type action for selected rows
  const handleBulkApplyType = useCallback((type: SuggestedWorkflowType) => {
    setReviewedRows(prev => prev.map(row => {
      if (selectedForBulk.has(row.rowIndex)) {
        return {
          ...row,
          selectedType: type,
          wasTypeOverridden: type !== row.suggestedType,
        };
      }
      return row;
    }));
    setSelectedForBulk(new Set());
  }, [selectedForBulk]);

  // Handle bulk client action for selected rows
  const handleBulkApplyClient = useCallback((clientId: string | null) => {
    setReviewedRows(prev => prev.map(row => {
      if (selectedForBulk.has(row.rowIndex)) {
        return {
          ...row,
          selectedClientId: clientId,
          wasClientOverridden: clientId !== row.suggestedClientId,
        };
      }
      return row;
    }));
    setSelectedForBulk(new Set());
  }, [selectedForBulk]);

  // Handle "Apply type to all"
  const handleApplyTypeToAll = useCallback((type: SuggestedWorkflowType) => {
    setReviewedRows(prev => prev.map(row => ({
      ...row,
      selectedType: type,
      wasTypeOverridden: type !== row.suggestedType,
    })));
  }, []);

  // Handle "Accept all suggestions"
  const handleAcceptAllSuggestions = useCallback(() => {
    setReviewedRows(prev => prev.map(row => ({
      ...row,
      selectedType: row.suggestedType !== 'UNKNOWN' ? row.suggestedType : row.selectedType,
      wasTypeOverridden: false,
      selectedClientId: row.suggestedClientId || row.selectedClientId,
      wasClientOverridden: false,
    })));
  }, []);

  // Toggle row selection for bulk action
  const toggleBulkSelection = useCallback((rowIndex: number, checked: boolean) => {
    setSelectedForBulk(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(rowIndex);
      } else {
        newSet.delete(rowIndex);
      }
      return newSet;
    });
  }, []);

  // Select all visible for bulk
  const selectAllVisibleForBulk = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedForBulk(new Set(displayRows.map(r => r.rowIndex)));
    } else {
      setSelectedForBulk(new Set());
    }
  }, [displayRows]);

  const allVisibleSelected = displayRows.length > 0 && displayRows.every(r => selectedForBulk.has(r.rowIndex));
  const someVisibleSelected = displayRows.some(r => selectedForBulk.has(r.rowIndex)) && !allVisibleSelected;

  const canProceed = stats.unclassified === 0;

  const truncateText = (text: string, maxLen: number = 35): string => {
    if (!text || text.length <= maxLen) return text || '-';
    return text.slice(0, maxLen) + "...";
  };

  if (clientsLoading || reviewedRows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Preparando revisión...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="font-semibold text-lg">Revisar y Clasificar Procesos</h3>
          <p className="text-sm text-muted-foreground">
            Clasifica cada proceso y vincula opcionalmente a un cliente
          </p>
        </div>
        
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-sm">
            {stats.classified}/{stats.total} clasificados
          </Badge>
          {stats.unclassified > 0 && (
            <Badge variant="destructive" className="text-sm">
              {stats.unclassified} sin clasificar
            </Badge>
          )}
          {stats.autoSuggested > 0 && (
            <Badge variant="secondary" className="text-sm flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {stats.autoSuggested} auto-detectados
            </Badge>
          )}
          <Badge variant="secondary" className="text-sm flex items-center gap-1">
            <Users className="h-3 w-3" />
            {stats.withClient} con cliente
          </Badge>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-lg flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Label className="text-sm font-medium">Acciones rápidas:</Label>
          
          {(stats.autoSuggested > 0 || stats.clientAutoSuggested > 0) && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleAcceptAllSuggestions}
              className="gap-1"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Aceptar sugerencias
            </Button>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                Aplicar tipo a todos
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Clasificar todos como:</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALLOWED_TYPES.map(type => (
                <DropdownMenuItem key={type} onClick={() => handleApplyTypeToAll(type)}>
                  {TYPE_ICONS[type]}
                  <span className="ml-2">{TYPE_LABELS[type]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedForBulk.size > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="default" size="sm" className="gap-1">
                    Tipo a {selectedForBulk.size} seleccionados
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Clasificar como:</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALLOWED_TYPES.map(type => (
                    <DropdownMenuItem key={type} onClick={() => handleBulkApplyType(type)}>
                      {TYPE_ICONS[type]}
                      <span className="ml-2">{TYPE_LABELS[type]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" className="gap-1">
                    <Users className="h-3.5 w-3.5" />
                    Cliente a seleccionados
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
                  <DropdownMenuLabel>Vincular a cliente:</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleBulkApplyClient(null)}>
                    <span className="text-muted-foreground">Sin cliente</span>
                  </DropdownMenuItem>
                  {clients.map(client => (
                    <DropdownMenuItem key={client.id} onClick={() => handleBulkApplyClient(client.id)}>
                      {client.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select 
            value={filterType} 
            onValueChange={(v) => setFilterType(v as SuggestedWorkflowType | 'ALL')}
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              {ALLOWED_TYPES.map(type => (
                <SelectItem key={type} value={type}>
                  {TYPE_LABELS[type]} ({stats.byType[type] || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Button
            variant={showOnlyUnclassified ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowOnlyUnclassified(!showOnlyUnclassified)}
            className="gap-1"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            Sin clasificar ({stats.unclassified})
          </Button>
        </div>
      </div>

      {/* Review Table */}
      <ScrollArea className="h-[400px] border rounded-lg">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={selectAllVisibleForBulk}
                  aria-label="Seleccionar para acción masiva"
                  className={someVisibleSelected ? "data-[state=checked]:bg-primary/50" : ""}
                />
              </TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead className="min-w-[160px]">Radicado</TableHead>
              <TableHead className="min-w-[180px]">Despacho</TableHead>
              <TableHead className="min-w-[150px]">Partes</TableHead>
              <TableHead className="w-[130px]">Tipo</TableHead>
              <TableHead className="w-[180px]">Cliente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row) => (
              <TableRow
                key={row.rowIndex}
                className={
                  row.selectedType === null 
                    ? "bg-destructive/5" 
                    : selectedForBulk.has(row.rowIndex) 
                      ? "bg-primary/5" 
                      : ""
                }
              >
                <TableCell>
                  <Checkbox
                    checked={selectedForBulk.has(row.rowIndex)}
                    onCheckedChange={(checked) => toggleBulkSelection(row.rowIndex, !!checked)}
                    aria-label={`Seleccionar fila ${row.rowIndex + 1}`}
                  />
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        {row.selectedType !== null ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        {row.selectedType !== null ? "Clasificado" : "Pendiente de clasificación"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.radicado_raw}
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm">{truncateText(row.despacho, 25)}</span>
                      </TooltipTrigger>
                      {row.despacho.length > 25 && (
                        <TooltipContent className="max-w-[350px]">
                          <p>{row.despacho}</p>
                          {row.matchedKeywords.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Palabras clave: {row.matchedKeywords.join(', ')}
                            </p>
                          )}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-xs space-y-0.5">
                          <div className="truncate max-w-[140px]">{row.demandantes || '-'}</div>
                          <div className="truncate max-w-[140px] text-muted-foreground">vs {row.demandados || '-'}</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[400px]">
                        <p><strong>Demandante:</strong> {row.demandantes || '-'}</p>
                        <p><strong>Demandado:</strong> {row.demandados || '-'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <Select
                    value={row.selectedType || ''}
                    onValueChange={(v) => handleRowTypeChange(row.rowIndex, v as SuggestedWorkflowType)}
                  >
                    <SelectTrigger 
                      className={`w-[110px] h-8 ${
                        row.selectedType === null 
                          ? 'border-destructive' 
                          : row.wasTypeOverridden 
                            ? 'border-amber-500' 
                            : ''
                      }`}
                    >
                      <SelectValue placeholder="Tipo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ALLOWED_TYPES.map(type => (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            {TYPE_ICONS[type]}
                            {TYPE_LABELS[type]}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Select
                      value={row.selectedClientId || 'none'}
                      onValueChange={(v) => handleRowClientChange(row.rowIndex, v === 'none' ? null : v)}
                    >
                      <SelectTrigger className="w-[150px] h-8">
                        <SelectValue placeholder="Sin cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          <span className="text-muted-foreground">Sin cliente</span>
                        </SelectItem>
                        {clients.map(client => (
                          <SelectItem key={client.id} value={client.id}>
                            {truncateText(client.name, 20)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.suggestedClientId && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Sparkles className="h-3 w-3 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Sugerido: {row.suggestedClientName} ({Math.round((row.suggestedClientScore || 0) * 100)}% match)
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          {stats.typeOverridden > 0 && (
            <span className="text-amber-600 mr-3">
              {stats.typeOverridden} tipos modificados manualmente
            </span>
          )}
          {stats.withClient > 0 && (
            <span className="text-primary">
              {stats.withClient} con cliente vinculado
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isImporting}>
            Cancelar
          </Button>
          <Button
            onClick={() => onRowsReviewed(reviewedRows)}
            disabled={!canProceed || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                Importar {stats.total} procesos
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
