/**
 * WorkItemDetail - Unified detail page for all work items
 * Uses the consolidated useWorkItemDetail hook for data fetching
 */

import { useParams, useNavigate } from "react-router-dom";
import { Loader2, ArrowLeft, ExternalLink, FileText, Calendar, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkItemDetail } from "@/hooks/use-work-item-detail";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function WorkItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const {
    workItem,
    isLoading,
    error,
    processEvents,
    actuaciones,
    documents,
    tasks,
    hearings,
  } = useWorkItemDetail(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !workItem) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">No se encontró el item de trabajo</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "d MMM yyyy", { locale: es });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      ACTIVE: "default",
      CLOSED: "secondary",
      ARCHIVED: "outline",
    };
    return <Badge variant={variants[status] || "default"}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold">
              {workItem.radicado || workItem.title || "Sin radicado"}
            </h1>
            {getStatusBadge(workItem.status)}
          </div>
          <p className="text-muted-foreground ml-10">
            {workItem.workflow_type} • {workItem.stage}
          </p>
        </div>
        <div className="flex gap-2">
          {workItem.expediente_url && (
            <Button variant="outline" asChild>
              <a href={workItem.expediente_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Ver expediente
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información General</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Radicado</p>
                <p className="font-medium">{workItem.radicado || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Autoridad</p>
                <p className="font-medium">{workItem.authority_name || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ciudad</p>
                <p className="font-medium">{workItem.authority_city || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Departamento</p>
                <p className="font-medium">{workItem.authority_department || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Demandantes</p>
                <p className="font-medium">{workItem.demandantes || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Demandados</p>
                <p className="font-medium">{workItem.demandados || "—"}</p>
              </div>
              {workItem.clients && (
                <div>
                  <p className="text-sm text-muted-foreground">Cliente</p>
                  <p className="font-medium">{workItem.clients.name}</p>
                </div>
              )}
              {workItem.matters && (
                <div>
                  <p className="text-sm text-muted-foreground">Asunto</p>
                  <p className="font-medium">{workItem.matters.matter_name}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabs for related data */}
          <Tabs defaultValue="timeline" className="w-full">
            <TabsList>
              <TabsTrigger value="timeline">
                <Clock className="h-4 w-4 mr-2" />
                Timeline ({processEvents.length})
              </TabsTrigger>
              <TabsTrigger value="actuaciones">
                <FileText className="h-4 w-4 mr-2" />
                Actuaciones ({actuaciones.length})
              </TabsTrigger>
              <TabsTrigger value="documents">
                <FileText className="h-4 w-4 mr-2" />
                Documentos ({documents.length})
              </TabsTrigger>
              <TabsTrigger value="hearings">
                <Calendar className="h-4 w-4 mr-2" />
                Audiencias ({hearings.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {processEvents.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No hay eventos registrados
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {processEvents.map((event: any) => (
                        <div key={event.id} className="flex gap-4 border-l-2 border-muted pl-4 pb-4">
                          <div className="flex-1">
                            <p className="font-medium">{event.event_type}</p>
                            <p className="text-sm text-muted-foreground">{event.description}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDate(event.event_date)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="actuaciones" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {actuaciones.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No hay actuaciones registradas
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {actuaciones.map((act: any) => (
                        <div key={act.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium">{act.normalized_text || act.raw_text}</p>
                              <p className="text-sm text-muted-foreground mt-1">
                                {formatDate(act.act_date)}
                              </p>
                            </div>
                            {act.act_type_guess && (
                              <Badge variant="outline">{act.act_type_guess}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {documents.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No hay documentos adjuntos
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {documents.map((doc: any) => (
                        <div key={doc.id} className="flex items-center justify-between border rounded-lg p-3">
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{doc.file_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(doc.uploaded_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hearings" className="mt-4">
              <Card>
                <CardContent className="pt-6">
                  {hearings.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No hay audiencias programadas
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {hearings.map((hearing: any) => (
                        <div key={hearing.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium">{hearing.hearing_type}</p>
                              <p className="text-sm text-muted-foreground">
                                {formatDate(hearing.scheduled_at)}
                              </p>
                            </div>
                            <Badge variant={hearing.status === 'COMPLETED' ? 'secondary' : 'default'}>
                              {hearing.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Tasks & Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Tareas
              </CardTitle>
              <CardDescription>{tasks.length} tareas</CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="text-muted-foreground text-sm">No hay tareas pendientes</p>
              ) : (
                <div className="space-y-2">
                  {tasks.slice(0, 5).map((task: any) => (
                    <div key={task.id} className="flex items-center gap-2 text-sm">
                      <div className={`h-2 w-2 rounded-full ${task.completed_at ? 'bg-green-500' : 'bg-yellow-500'}`} />
                      <span className={task.completed_at ? 'line-through text-muted-foreground' : ''}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fechas Clave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Creado</p>
                <p className="font-medium">{formatDate(workItem.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última actualización</p>
                <p className="font-medium">{formatDate(workItem.updated_at)}</p>
              </div>
              {workItem.filing_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Fecha de radicación</p>
                  <p className="font-medium">{formatDate(workItem.filing_date)}</p>
                </div>
              )}
              {workItem.auto_admisorio_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Auto admisorio</p>
                  <p className="font-medium">{formatDate(workItem.auto_admisorio_date)}</p>
                </div>
              )}
              {workItem.last_action_date && (
                <div>
                  <p className="text-sm text-muted-foreground">Última actuación</p>
                  <p className="font-medium">{formatDate(workItem.last_action_date)}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {workItem.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{workItem.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
