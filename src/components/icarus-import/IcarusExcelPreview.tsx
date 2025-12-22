import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { IcarusExcelRow } from "@/lib/icarus-excel-parser";

interface IcarusExcelPreviewProps {
  rows: IcarusExcelRow[];
  selectedRows: Set<number>;
  onSelectionChange: (selected: Set<number>) => void;
  maxPreviewRows?: number;
}

export function IcarusExcelPreview({
  rows,
  selectedRows,
  onSelectionChange,
  maxPreviewRows = 50,
}: IcarusExcelPreviewProps) {
  const [showAll, setShowAll] = useState(false);
  
  const displayRows = showAll ? rows : rows.slice(0, maxPreviewRows);
  const hasMore = rows.length > maxPreviewRows && !showAll;
  
  const allSelected = rows.every((_, i) => selectedRows.has(i));
  const someSelected = rows.some((_, i) => selectedRows.has(i)) && !allSelected;
  
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select all valid rows
      const newSelection = new Set(
        rows.map((row, i) => (row.is_valid ? i : -1)).filter(i => i >= 0)
      );
      onSelectionChange(newSelection);
    } else {
      onSelectionChange(new Set());
    }
  };
  
  const handleRowSelect = (index: number, checked: boolean) => {
    const newSelection = new Set(selectedRows);
    if (checked) {
      newSelection.add(index);
    } else {
      newSelection.delete(index);
    }
    onSelectionChange(newSelection);
  };
  
  const truncateText = (text: string, maxLen: number = 40): string => {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Vista previa ({rows.length} procesos)
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSelectAll(!allSelected)}
          >
            {allSelected ? "Deseleccionar todo" : "Seleccionar todo"}
          </Button>
        </div>
      </div>
      
      <ScrollArea className="h-[400px] border rounded-lg">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Seleccionar todo"
                  className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
                />
              </TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead className="min-w-[200px]">Número del proceso</TableHead>
              <TableHead>Despacho</TableHead>
              <TableHead>Distrito</TableHead>
              <TableHead>Demandante(s)</TableHead>
              <TableHead>Demandado(s)</TableHead>
              <TableHead>Última actuación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row, index) => (
              <TableRow
                key={index}
                className={!row.is_valid ? "bg-destructive/5" : selectedRows.has(index) ? "bg-primary/5" : ""}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedRows.has(index)}
                    onCheckedChange={(checked) => handleRowSelect(index, !!checked)}
                    disabled={!row.is_valid}
                    aria-label={`Seleccionar fila ${index + 1}`}
                  />
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        {row.is_valid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        {row.is_valid ? "Válido" : row.validation_error}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <div className="flex flex-col">
                    <span>{row.radicado_raw}</span>
                    {!row.is_valid && row.validation_error && (
                      <Badge variant="destructive" className="text-[10px] w-fit mt-1">
                        {row.validation_error}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm">{truncateText(row.despacho, 30)}</span>
                      </TooltipTrigger>
                      {row.despacho.length > 30 && (
                        <TooltipContent className="max-w-[300px]">
                          {row.despacho}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell className="text-sm">{row.distrito}</TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm">{truncateText(row.demandantes, 25)}</span>
                      </TooltipTrigger>
                      {row.demandantes.length > 25 && (
                        <TooltipContent className="max-w-[300px]">
                          {row.demandantes}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm">{truncateText(row.demandados, 25)}</span>
                      </TooltipTrigger>
                      {row.demandados.length > 25 && (
                        <TooltipContent className="max-w-[300px]">
                          {row.demandados}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col text-sm">
                    <span>{row.last_action_date_iso || row.last_action_date_raw || "-"}</span>
                    {row.last_action_date_raw && !row.last_action_date_iso && (
                      <Badge variant="secondary" className="text-[10px] w-fit mt-1">
                        No parseado
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
      
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Mostrar {rows.length - maxPreviewRows} filas más
          </Button>
        </div>
      )}
    </div>
  );
}
