import { useState, useMemo, useCallback, useEffect } from "react";
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
  Briefcase,
} from "lucide-react";
import type { IcarusExcelRow } from "@/lib/icarus-excel-parser";
import {
  detectWorkflowType,
  type SuggestedWorkflowType,
} from "@/lib/icarus-workflow-detection";

// Extended row type with classification
export interface ClassifiedRow extends IcarusExcelRow {
  rowIndex: number;
  suggestedType: SuggestedWorkflowType;
  selectedType: SuggestedWorkflowType | null;
  wasOverridden: boolean;
  matchedKeywords: string[];
}

interface IcarusRowClassificationProps {
  rows: IcarusExcelRow[];
  selectedRowIndices: Set<number>;
  onRowsClassified: (classifiedRows: ClassifiedRow[]) => void;
  onCancel: () => void;
}

const ALLOWED_TYPES: SuggestedWorkflowType[] = ['CGP', 'CPACA', 'TUTELA', 'LABORAL'];

const TYPE_ICONS: Record<SuggestedWorkflowType, React.ReactNode> = {
  CGP: <Scale className="h-4 w-4" />,
  CPACA: <Landmark className="h-4 w-4" />,
  TUTELA: <Gavel className="h-4 w-4" />,
  LABORAL: <Briefcase className="h-4 w-4" />,
  UNKNOWN: <HelpCircle className="h-4 w-4" />,
};

const TYPE_LABELS: Record<SuggestedWorkflowType, string> = {
  CGP: 'CGP',
  CPACA: 'CPACA',
  TUTELA: 'Tutela',
  LABORAL: 'Laboral',
  UNKNOWN: 'Sin clasificar',
};

const TYPE_COLORS: Record<SuggestedWorkflowType, string> = {
  CGP: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  CPACA: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  TUTELA: 'bg-purple-100 text-purple-700 border-purple-300',
  LABORAL: 'bg-rose-100 text-rose-700 border-rose-300',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

export function IcarusRowClassification({
  rows,
  selectedRowIndices,
  onRowsClassified,
  onCancel,
}: IcarusRowClassificationProps) {
  // Initialize classified rows with auto-detection
  const [classifiedRows, setClassifiedRows] = useState<ClassifiedRow[]>(() => {
    return rows
      .filter((_, idx) => selectedRowIndices.has(idx))
      .map((row, i) => {
        const detection = detectWorkflowType(row.despacho);
        const originalIndex = Array.from(selectedRowIndices)[i];
        return {
          ...row,
          rowIndex: originalIndex,
          suggestedType: detection.suggestedType,
          selectedType: detection.suggestedType !== 'UNKNOWN' ? detection.suggestedType : null,
          wasOverridden: false,
          matchedKeywords: detection.matchedKeywords,
        };
      });
  });

  const [selectedForBulk, setSelectedForBulk] = useState<Set<number>>(new Set());
  const [filterType, setFilterType] = useState<SuggestedWorkflowType | 'ALL'>('ALL');
  const [showOnlyUnclassified, setShowOnlyUnclassified] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const total = classifiedRows.length;
    const classified = classifiedRows.filter(r => r.selectedType !== null).length;
    const unclassified = total - classified;
    const byType = ALLOWED_TYPES.reduce((acc, type) => {
      acc[type] = classifiedRows.filter(r => r.selectedType === type).length;
      return acc;
    }, {} as Record<string, number>);
    const autoSuggested = classifiedRows.filter(r => r.suggestedType !== 'UNKNOWN').length;
    const overridden = classifiedRows.filter(r => r.wasOverridden).length;
    
    return { total, classified, unclassified, byType, autoSuggested, overridden };
  }, [classifiedRows]);

  // Filtered rows for display
  const displayRows = useMemo(() => {
    let filtered = classifiedRows;
    
    if (filterType !== 'ALL') {
      filtered = filtered.filter(r => r.selectedType === filterType || r.suggestedType === filterType);
    }
    
    if (showOnlyUnclassified) {
      filtered = filtered.filter(r => r.selectedType === null);
    }
    
    return filtered;
  }, [classifiedRows, filterType, showOnlyUnclassified]);

  // Handle single row type change
  const handleRowTypeChange = useCallback((rowIndex: number, newType: SuggestedWorkflowType) => {
    setClassifiedRows(prev => prev.map(row => {
      if (row.rowIndex === rowIndex) {
        return {
          ...row,
          selectedType: newType,
          wasOverridden: newType !== row.suggestedType,
        };
      }
      return row;
    }));
  }, []);

  // Handle bulk action for selected rows
  const handleBulkApply = useCallback((type: SuggestedWorkflowType) => {
    setClassifiedRows(prev => prev.map(row => {
      if (selectedForBulk.has(row.rowIndex)) {
        return {
          ...row,
          selectedType: type,
          wasOverridden: type !== row.suggestedType,
        };
      }
      return row;
    }));
    setSelectedForBulk(new Set());
  }, [selectedForBulk]);

  // Handle "Apply to all" action
  const handleApplyToAll = useCallback((type: SuggestedWorkflowType) => {
    setClassifiedRows(prev => prev.map(row => ({
      ...row,
      selectedType: type,
      wasOverridden: type !== row.suggestedType,
    })));
  }, []);

  // Handle "Accept all suggestions"
  const handleAcceptAllSuggestions = useCallback(() => {
    setClassifiedRows(prev => prev.map(row => ({
      ...row,
      selectedType: row.suggestedType !== 'UNKNOWN' ? row.suggestedType : row.selectedType,
      wasOverridden: false,
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

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="font-semibold text-lg">Clasificar Procesos</h3>
          <p className="text-sm text-muted-foreground">
            Selecciona el tipo de proceso para cada fila antes de importar
          </p>
        </div>
        
        <div className="flex gap-2">
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
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex items-center justify-between gap-4 p-3 bg-muted/50 rounded-lg flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Label className="text-sm font-medium">Acciones rápidas:</Label>
          
          {stats.autoSuggested > 0 && (
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
                Aplicar a todos
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Clasificar todos como:</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {ALLOWED_TYPES.map(type => (
                <DropdownMenuItem key={type} onClick={() => handleApplyToAll(type)}>
                  {TYPE_ICONS[type]}
                  <span className="ml-2">{TYPE_LABELS[type]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedForBulk.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" size="sm" className="gap-1">
                  Aplicar a {selectedForBulk.size} seleccionados
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Clasificar seleccionados como:</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ALLOWED_TYPES.map(type => (
                  <DropdownMenuItem key={type} onClick={() => handleBulkApply(type)}>
                    {TYPE_ICONS[type]}
                    <span className="ml-2">{TYPE_LABELS[type]}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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

      {/* Classification Table */}
      <ScrollArea className="h-[450px] border rounded-lg">
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
              <TableHead className="min-w-[180px]">Radicado</TableHead>
              <TableHead className="min-w-[200px]">Despacho</TableHead>
              <TableHead className="w-[100px]">Sugerido</TableHead>
              <TableHead className="w-[150px]">Tipo de Proceso</TableHead>
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
                        <span className="text-sm">{truncateText(row.despacho, 30)}</span>
                      </TooltipTrigger>
                      {row.despacho.length > 30 && (
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
                  {row.suggestedType !== 'UNKNOWN' ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge 
                            variant="outline" 
                            className={`text-xs ${TYPE_COLORS[row.suggestedType]} flex items-center gap-1`}
                          >
                            <Sparkles className="h-3 w-3" />
                            {TYPE_LABELS[row.suggestedType]}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Detectado por: {row.matchedKeywords.join(', ')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      -
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={row.selectedType || ''}
                    onValueChange={(v) => handleRowTypeChange(row.rowIndex, v as SuggestedWorkflowType)}
                  >
                    <SelectTrigger 
                      className={`w-[130px] h-8 ${
                        row.selectedType === null 
                          ? 'border-destructive' 
                          : row.wasOverridden 
                            ? 'border-amber-500' 
                            : ''
                      }`}
                    >
                      <SelectValue placeholder="Seleccionar..." />
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div className="text-sm text-muted-foreground">
          {stats.overridden > 0 && (
            <span className="text-amber-600">
              {stats.overridden} clasificación(es) modificada(s) manualmente
            </span>
          )}
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            onClick={() => onRowsClassified(classifiedRows)}
            disabled={!canProceed}
          >
            {canProceed 
              ? `Importar ${stats.total} Procesos` 
              : `Clasificar ${stats.unclassified} restantes`
            }
          </Button>
        </div>
      </div>
    </div>
  );
}
