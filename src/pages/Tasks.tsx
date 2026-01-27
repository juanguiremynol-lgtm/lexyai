import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, ExternalLink, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { TASK_TYPES, formatDateColombia, getDaysDiff } from "@/lib/constants";
import type { TaskStatus, TaskType } from "@/types/database";

export default function Tasks() {
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select(`
          *,
          filing:filings(
            id,
            filing_type,
            matter:matters(client_name, matter_name)
          )
        `)
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: TaskStatus;
    }) => {
      const updates: Record<string, unknown> = { status };
      if (status === "SNOOZED") {
        const newDue = new Date();
        newDue.setDate(newDue.getDate() + 2);
        updates.due_at = newDue.toISOString();
      }
      const { error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Tarea actualizada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const filteredTasks = tasks?.filter((t) =>
    statusFilter === "all" ? true : t.status === statusFilter
  );

  const getTaskColor = (type: TaskType) => {
    return TASK_TYPES[type]?.color || "safe";
  };

  const getDueBadge = (dueAt: string) => {
    const days = getDaysDiff(dueAt);
    if (days === null) return null;

    if (days < 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          Vencida hace {Math.abs(days)}d
        </Badge>
      );
    }
    if (days === 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          Vence hoy
        </Badge>
      );
    }
    if (days <= 2) {
      return (
        <Badge className="bg-sla-warning text-sla-warning-foreground text-xs">
          En {days}d
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-xs">
        En {days}d
      </Badge>
    );
  };

  const openCount = tasks?.filter((t) => t.status === "OPEN").length || 0;
  const overdueCount =
    tasks?.filter((t) => {
      if (t.status !== "OPEN") return false;
      const days = getDaysDiff(t.due_at);
      return days !== null && days < 0;
    }).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Tareas</h1>
          <p className="text-muted-foreground">
            {openCount} tareas abiertas • {overdueCount} vencidas
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Abiertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vencidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">{overdueCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completadas Hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {tasks?.filter((t) => {
                if (t.status !== "DONE") return false;
                const today = new Date().toDateString();
                return new Date(t.updated_at).toDateString() === today;
              }).length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Lista de Tareas</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="OPEN">Abiertas</SelectItem>
                <SelectItem value="DONE">Completadas</SelectItem>
                <SelectItem value="SNOOZED">Pospuestas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : filteredTasks?.length === 0 ? (
            <div className="text-center py-12">
              <ListTodo className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No hay tareas</h3>
              <p className="text-muted-foreground">
                Las tareas se crean automáticamente al gestionar radicaciones
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarea</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Radicación</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks?.map((task) => {
                  const filing = task.filing as {
                    id: string;
                    filing_type: string;
                    matter: { client_name: string; matter_name: string } | null;
                  } | null;
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <p className="font-medium">{task.title}</p>
                        {task.auto_generated && (
                          <Badge variant="outline" className="text-xs mt-1">
                            Auto-generada
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`bg-sla-${getTaskColor(task.type as TaskType)} text-sla-${getTaskColor(task.type as TaskType)}-foreground`}
                        >
                          {TASK_TYPES[task.type as TaskType]?.label || task.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {filing ? (
                          <div>
                            <p className="text-sm">
                              {filing.matter?.client_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {filing.matter?.matter_name}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm">
                            {formatDateColombia(task.due_at)}
                          </span>
                          {task.status === "OPEN" && getDueBadge(task.due_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            task.status === "DONE"
                              ? "secondary"
                              : task.status === "SNOOZED"
                              ? "outline"
                              : "default"
                          }
                        >
                          {task.status === "DONE"
                            ? "Completada"
                            : task.status === "SNOOZED"
                            ? "Pospuesta"
                            : "Abierta"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {task.status === "OPEN" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  updateTask.mutate({
                                    id: task.id,
                                    status: "DONE",
                                  })
                                }
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Completar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateTask.mutate({
                                    id: task.id,
                                    status: "SNOOZED",
                                  })
                                }
                              >
                                <Clock className="h-4 w-4 mr-1" />
                                +2d
                              </Button>
                            </>
                          )}
                          {filing && (
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/app/work-items/${filing.id}`}>
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
