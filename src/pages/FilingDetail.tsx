import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { SlaBadge } from "@/components/ui/sla-badge";
import { DocumentUpload } from "@/components/filings/DocumentUpload";
import { DocumentList } from "@/components/filings/DocumentList";
import { ProcessTimeline } from "@/components/filings/ProcessTimeline";
import { HearingsList } from "@/components/filings/HearingsList";
import { CrawlerControl } from "@/components/filings/CrawlerControl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Building2,
  Mail,
  FileText,
  CheckCircle,
  Copy,
  Save,
  Clock,
  Calendar,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  FILING_STATUSES,
  COLOMBIAN_DEPARTMENTS,
  EMAIL_TEMPLATES,
  validateRadicado,
  formatDateColombia,
} from "@/lib/constants";
import type { FilingStatus } from "@/types/database";

export default function FilingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const { data: filing, isLoading } = useQuery({
    queryKey: ["filing", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("filings")
        .select(`
          *,
          matter:matters(id, client_name, matter_name, practice_area),
          documents(*),
          emails(*),
          tasks(*)
        `)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const updateFiling = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase
        .from("filings")
        .update(updates)
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["filing", id] });
      toast.success("Radicación actualizada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const deleteFiling = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("filings")
        .delete()
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Radicación eliminada");
      navigate("/filings");
    },
    onError: (error) => {
      toast.error("Error al eliminar: " + error.message);
    },
  });

  const handleCourtUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateFiling.mutate({
      court_name: form.get("court_name"),
      court_email: form.get("court_email"),
      court_city: form.get("court_city"),
      court_department: form.get("court_department"),
    });
  };

  const handleRadicadoUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const radicado = form.get("radicado") as string;
    
    if (radicado && !validateRadicado(radicado)) {
      toast.error("El radicado debe tener exactamente 23 dígitos");
      return;
    }

    updateFiling.mutate({
      radicado,
      status: radicado ? "RADICADO_CONFIRMED" : filing?.status,
    });
  };

  const handleStatusChange = (newStatus: FilingStatus) => {
    updateFiling.mutate({ status: newStatus });
  };

  const getEmailBody = (templateKey: string) => {
    const template = EMAIL_TEMPLATES[templateKey as keyof typeof EMAIL_TEMPLATES];
    if (!template || !filing) return "";

    const matter = filing.matter as { client_name: string; matter_name: string } | null;
    
    return template.body
      .replace("{{sent_at}}", filing.sent_at ? formatDateColombia(filing.sent_at) : "[Fecha de envío]")
      .replace("{{matter_name}}", matter?.matter_name || "[Asunto]")
      .replace("{{client_name}}", matter?.client_name || "[Cliente]")
      .replace("{{court_name}}", filing.court_name || "[Juzgado]")
      .replace("{{court_city}}", filing.court_city || "[Ciudad]")
      .replace("{{court_department}}", filing.court_department || "[Departamento]")
      .replace("{{acta_received_at}}", filing.acta_received_at ? formatDateColombia(filing.acta_received_at) : "[Fecha acta]")
      .replace("{{reparto_reference}}", filing.reparto_reference || "[Referencia]")
      .replace(/\{\{signature_block\}\}/g, profile?.signature_block || "[Firma]");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!filing) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Radicación no encontrada</p>
        <Button asChild className="mt-4">
          <Link to="/filings">Volver a Radicaciones</Link>
        </Button>
      </div>
    );
  }

  const matter = filing.matter as { client_name: string; matter_name: string; practice_area: string | null } | null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/filings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-serif font-bold">
              {matter?.client_name} – {matter?.matter_name}
            </h1>
            <StatusBadge status={filing.status as FilingStatus} />
          </div>
          <p className="text-muted-foreground">
            {filing.filing_type} • {matter?.practice_area || "Sin área"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filing.status}
            onValueChange={(v) => handleStatusChange(v as FilingStatus)}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FILING_STATUSES).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar radicación?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acción eliminará permanentemente esta radicación y todos sus documentos asociados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteFiling.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SLA Badges */}
        <Card className="lg:col-span-3">
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4">
              {filing.sla_receipt_due_at && (
                <SlaBadge
                  dueDate={filing.sla_receipt_due_at}
                  label="Recibo de reparto"
                />
              )}
              {filing.sla_acta_due_at && (
                <SlaBadge dueDate={filing.sla_acta_due_at} label="Acta de reparto" />
              )}
              {filing.sla_court_reply_due_at && (
                <SlaBadge
                  dueDate={filing.sla_court_reply_due_at}
                  label="Respuesta juzgado"
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="court" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="court">
                <Building2 className="h-4 w-4 mr-2" />
                Juzgado
              </TabsTrigger>
              <TabsTrigger value="timeline">
                <Clock className="h-4 w-4 mr-2" />
                Actuaciones
              </TabsTrigger>
              <TabsTrigger value="hearings">
                <Calendar className="h-4 w-4 mr-2" />
                Audiencias
              </TabsTrigger>
              <TabsTrigger value="emails">
                <Mail className="h-4 w-4 mr-2" />
                Correos
              </TabsTrigger>
              <TabsTrigger value="documents">
                <FileText className="h-4 w-4 mr-2" />
                Documentos
              </TabsTrigger>
            </TabsList>

            <TabsContent value="court" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Datos del Juzgado</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCourtUpdate} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="court_name">Nombre del Juzgado</Label>
                        <Input
                          id="court_name"
                          name="court_name"
                          defaultValue={filing.court_name || ""}
                          placeholder="Ej: Juzgado 15 Civil del Circuito"
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="court_email">Correo del Juzgado</Label>
                        <Input
                          id="court_email"
                          name="court_email"
                          type="email"
                          defaultValue={filing.court_email || ""}
                          placeholder="Ej: j15cctobog@cendoj.ramajudicial.gov.co"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_city">Ciudad</Label>
                        <Input
                          id="court_city"
                          name="court_city"
                          defaultValue={filing.court_city || ""}
                          placeholder="Ej: Bogotá"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="court_department">Departamento</Label>
                        <Select
                          name="court_department"
                          defaultValue={filing.court_department || ""}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dept) => (
                              <SelectItem key={dept} value={dept}>
                                {dept}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button type="submit" disabled={updateFiling.isPending}>
                      <Save className="h-4 w-4 mr-2" />
                      Guardar Datos del Juzgado
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Radicado</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRadicadoUpdate} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="radicado">Número de Radicado (23 dígitos)</Label>
                      <Input
                        id="radicado"
                        name="radicado"
                        defaultValue={filing.radicado || ""}
                        placeholder="Ej: 11001310301520230001200"
                        maxLength={23}
                        pattern="\d{23}"
                      />
                      <p className="text-sm text-muted-foreground">
                        Formato: 23 dígitos numéricos exactos
                      </p>
                    </div>
                    <Button type="submit" disabled={updateFiling.isPending}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirmar Radicado
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              <CrawlerControl
                filingId={filing.id}
                radicado={filing.radicado}
                crawlerEnabled={filing.crawler_enabled}
                lastCrawledAt={filing.last_crawled_at}
                ramaJudicialUrl={filing.rama_judicial_url}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Actuaciones del Proceso</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProcessTimeline filingId={filing.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hearings" className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <HearingsList filingId={filing.id} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="emails" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Plantillas de Correo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(EMAIL_TEMPLATES).map(([key, template]) => (
                      <Button
                        key={key}
                        variant={selectedTemplate === key ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedTemplate(key)}
                      >
                        {template.name}
                      </Button>
                    ))}
                  </div>

                  {selectedTemplate && (
                    <div className="space-y-4">
                      <Separator />
                      <div className="space-y-2">
                        <Label>Asunto</Label>
                        <div className="flex gap-2">
                          <Input
                            readOnly
                            value={getEmailBody(selectedTemplate).split("\n")[0] || EMAIL_TEMPLATES[selectedTemplate as keyof typeof EMAIL_TEMPLATES]?.subject}
                            className="flex-1"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              copyToClipboard(
                                EMAIL_TEMPLATES[selectedTemplate as keyof typeof EMAIL_TEMPLATES]?.subject || ""
                              )
                            }
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Cuerpo del Correo</Label>
                        <Textarea
                          readOnly
                          value={getEmailBody(selectedTemplate)}
                          className="min-h-[300px] font-mono text-sm"
                        />
                        <Button
                          onClick={() => copyToClipboard(getEmailBody(selectedTemplate))}
                          className="w-full"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copiar al Portapapeles
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Cargar Documento</CardTitle>
                </CardHeader>
                <CardContent>
                  <DocumentUpload filingId={filing.id} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Documentos Adjuntos</CardTitle>
                </CardHeader>
                <CardContent>
                  {(filing.documents as unknown[])?.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                      <p className="mt-2 text-muted-foreground">
                        No hay documentos adjuntos
                      </p>
                    </div>
                  ) : (
                    <DocumentList
                      documents={filing.documents as Array<{
                        id: string;
                        kind: "DEMANDA" | "ACTA_REPARTO" | "AUTO_RECEIPT" | "COURT_RESPONSE" | "OTHER";
                        original_filename: string;
                        file_path: string;
                        uploaded_at: string;
                      }>}
                      filingId={filing.id}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Enviado a Reparto</p>
                <p className="font-medium">
                  {filing.sent_at ? formatDateColombia(filing.sent_at) : "No enviado"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Correo de Reparto</p>
                <p className="font-medium">
                  {filing.reparto_email_to || "No especificado"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Referencia Reparto</p>
                <p className="font-medium">
                  {filing.reparto_reference || "Sin referencia"}
                </p>
              </div>
              {filing.acta_received_at && (
                <div>
                  <p className="text-sm text-muted-foreground">Acta Recibida</p>
                  <p className="font-medium">
                    {formatDateColombia(filing.acta_received_at)}
                  </p>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Creado</p>
                <p className="font-medium">{formatDateColombia(filing.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Última actualización</p>
                <p className="font-medium">{formatDateColombia(filing.updated_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tareas Asociadas</CardTitle>
            </CardHeader>
            <CardContent>
              {(filing.tasks as unknown[])?.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay tareas</p>
              ) : (
                <div className="space-y-2">
                  {(filing.tasks as Array<{ id: string; title: string; status: string }>)?.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Badge
                        variant={task.status === "DONE" ? "secondary" : "default"}
                      >
                        {task.status}
                      </Badge>
                      <span>{task.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
