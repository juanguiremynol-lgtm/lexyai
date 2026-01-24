import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Eye,
  Calendar,
  Building2,
  Users,
  Flag,
  RefreshCw,
  Scale,
  Filter,
  AlertCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { useWorkItemsList } from "@/hooks/use-work-items-list";
import { WorkflowTypeBadge } from "@/components/processes/WorkflowTypeBadge";
import { ClientRequiredBadge } from "@/components/shared/ClientRequiredBadge";
import { BulkDeleteWorkItemsDialog } from "@/components/shared/BulkDeleteWorkItemsDialog";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";
import { getStageLabel } from "@/lib/workflow-constants";
import { cn } from "@/lib/utils";

export default function Processes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedWorkflowTypes, setSelectedWorkflowTypes] = useState<WorkflowType[]>([
    "CGP",
    "CPACA",
    "TUTELA",
  ]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch work items using the new hook
  const { data: workItems, isLoading, refetch } = useWorkItemsList({
    filters: {
      search,
      workflowTypes: selectedWorkflowTypes,
    },
  });

  const filteredItems = workItems || [];
  const allSelected = filteredItems.length > 0 && selectedItems.size === filteredItems.length;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)));
    }
  };

  const handleSelectItem = (id: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedItems(newSelection);
  };

  const toggleWorkflowFilter = (type: WorkflowType) => {
    setSelectedWorkflowTypes((prev) => {
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  const handleDeleteComplete = () => {
    setSelectedItems(new Set());
    setDeleteDialogOpen(false);
    queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
    queryClient.invalidateQueries({ queryKey: ["work-items"] });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd MMM yyyy", { locale: es });
    } catch {
      return "—";
    }
  };

  const formatRelativeDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
    } catch {
      return null;
    }
  };

  const truncateText = (text: string | null, maxLength: number = 30) => {
    if (!text) return "—";
    return text.length > maxLength ? text.substring(0, maxLength) + "…" : text;
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Scale className="h-8 w-8 text-primary" />
            Procesos
          </h1>
          <p className="text-muted-foreground mt-1">
            {filteredItems.length} proceso{filteredItems.length !== 1 ? "s" : ""} encontrado{filteredItems.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por radicado, cliente, despacho, partes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Tipo
                  <Badge variant="secondary" className="ml-1">
                    {selectedWorkflowTypes.length}
                  </Badge>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {(["CGP", "CPACA", "TUTELA", "PETICION", "GOV_PROCEDURE"] as WorkflowType[]).map((type) => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={selectedWorkflowTypes.includes(type)}
                    onCheckedChange={() => toggleWorkflowFilter(type)}
                  >
                    {WORKFLOW_TYPES[type].label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedItems.size} proceso{selectedItems.size !== 1 ? "s" : ""} seleccionado{selectedItems.size !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  Eliminar seleccionados
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedItems(new Set())}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Lista de Procesos</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <Scale className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No hay procesos</h3>
              <p className="text-muted-foreground mt-1">
                {search
                  ? "No se encontraron procesos con esos criterios de búsqueda."
                  : "Importa procesos desde ICARUS o créalos manualmente."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Radicado</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Despacho</TableHead>
                    <TableHead>Partes</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Última Actualización</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const relativeDate = formatRelativeDate(item.updated_at);
                    return (
                      <TableRow
                        key={item.id}
                        className={cn(
                          "hover:bg-muted/50 transition-colors",
                          item.is_flagged && "bg-destructive/5"
                        )}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedItems.has(item.id)}
                            onCheckedChange={() => handleSelectItem(item.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.is_flagged && (
                              <Flag className="h-4 w-4 text-destructive fill-destructive" />
                            )}
                            <span className="font-mono text-sm">
                              {item.radicado || "Sin radicado"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <WorkflowTypeBadge workflowType={item.workflow_type} />
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[200px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="truncate text-sm">
                                    {truncateText(item.authority_name, 25)}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              {item.authority_name && (
                                <TooltipContent>
                                  <p>{item.authority_name}</p>
                                  {item.authority_city && (
                                    <p className="text-xs text-muted-foreground">
                                      {item.authority_city}
                                    </p>
                                  )}
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px]">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="truncate text-sm">
                                    {truncateText(
                                      item.demandantes || item.demandados || "—",
                                      20
                                    )}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              {(item.demandantes || item.demandados) && (
                                <TooltipContent className="max-w-sm">
                                  {item.demandantes && (
                                    <p>
                                      <strong>Demandante:</strong> {item.demandantes}
                                    </p>
                                  )}
                                  {item.demandados && (
                                    <p>
                                      <strong>Demandado:</strong> {item.demandados}
                                    </p>
                                  )}
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.clients ? (
                            <Badge variant="outline" className="font-normal">
                              {truncateText(item.clients.name, 15)}
                            </Badge>
                          ) : (
                            <ClientRequiredBadge hasClient={false} size="sm" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <Tooltip>
                              <TooltipTrigger>
                                <span>{relativeDate || formatDate(item.updated_at)}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatDate(item.updated_at)}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {getStageLabel(item.workflow_type, item.stage, item.cgp_phase)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link to={`/work-items/${item.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4 mr-1" />
                              Ver
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <BulkDeleteWorkItemsDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        workItemIds={Array.from(selectedItems)}
        onDeleted={handleDeleteComplete}
      />
    </div>
  );
}
