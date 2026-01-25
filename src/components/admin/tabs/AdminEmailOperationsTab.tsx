/**
 * Admin Email Operations Tab - Email outbox dashboard
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Mail, 
  Search, 
  RotateCcw, 
  XCircle, 
  Eye,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { logAudit } from "@/lib/audit-log";

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  PENDING: { 
    label: "Pendiente", 
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    icon: Clock
  },
  SENT: { 
    label: "Enviado", 
    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    icon: CheckCircle2
  },
  FAILED: { 
    label: "Fallido", 
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    icon: AlertTriangle
  },
  BOUNCED: { 
    label: "Rebotado", 
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    icon: Ban
  },
  CANCELLED: { 
    label: "Cancelado", 
    className: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    icon: XCircle
  },
};

interface EmailOutboxItem {
  id: string;
  to_email: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  attempts: number;
  error: string | null;
  next_attempt_at: string | null;
  html: string | null;
  failed_permanent: boolean | null;
  failure_type: string | null;
  provider_message_id: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
}

export function AdminEmailOperationsTab() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<EmailOutboxItem | null>(null);
  const [showPermanentOnly, setShowPermanentOnly] = useState(false);
  const [failureTypeFilter, setFailureTypeFilter] = useState<string>("all");
  const [retryOverrideDialogOpen, setRetryOverrideDialogOpen] = useState(false);
  const [emailToRetryOverride, setEmailToRetryOverride] = useState<EmailOutboxItem | null>(null);

  // Fetch email outbox
  const { data: emails, isLoading } = useQuery({
    queryKey: ["admin-email-outbox", organization?.id, statusFilter],
    queryFn: async () => {
      if (!organization?.id) return [];

      let query = supabase
        .from("email_outbox")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as EmailOutboxItem[];
    },
    enabled: !!organization?.id,
  });

  // Filter by search and permanent failure
  const filteredEmails = emails?.filter(email => {
    const matchesSearch = !searchQuery ||
      email.to_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesPermanent = !showPermanentOnly || email.failed_permanent === true;
    
    const matchesFailureType = failureTypeFilter === "all" || 
      email.failure_type === failureTypeFilter;
    
    return matchesSearch && matchesPermanent && matchesFailureType;
  }) || [];

  // Retry failed email (non-permanent)
  const retryEmail = useMutation({
    mutationFn: async (email: EmailOutboxItem) => {
      if (email.failed_permanent) {
        throw new Error("Cannot retry permanently failed email. Use override option.");
      }
      
      const { error } = await supabase
        .from("email_outbox")
        .update({
          status: "PENDING",
          attempts: 0,
          error: null,
          next_attempt_at: new Date().toISOString(),
        })
        .eq("id", email.id);

      if (error) throw error;

      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_RETRY",
          entityType: "email_outbox",
          entityId: email.id,
          metadata: {
            to_email: email.to_email,
            subject: email.subject,
            previous_status: email.status,
            previous_attempts: email.attempts,
            previous_error: email.error,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-outbox"] });
      toast.success("Correo programado para reenvío");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Retry override for permanent failures (requires confirmation)
  const retryOverrideMutation = useMutation({
    mutationFn: async (email: EmailOutboxItem) => {
      const { error } = await supabase
        .from("email_outbox")
        .update({
          status: "PENDING",
          attempts: 0,
          error: null,
          failed_permanent: false,
          failure_type: null,
          next_attempt_at: new Date().toISOString(),
        })
        .eq("id", email.id);

      if (error) throw error;

      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_RETRY_OVERRIDE",
          entityType: "email_outbox",
          entityId: email.id,
          metadata: {
            to_email: email.to_email,
            subject: email.subject,
            previous_status: email.status,
            previous_failure_type: email.failure_type,
            override_reason: "Admin manual override",
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-outbox"] });
      toast.success("Fallo permanente anulado, correo programado para reenvío");
      setRetryOverrideDialogOpen(false);
      setEmailToRetryOverride(null);
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Cancel pending email
  const cancelEmail = useMutation({
    mutationFn: async (email: EmailOutboxItem) => {
      const { error } = await supabase
        .from("email_outbox")
        .update({ status: "CANCELLED" })
        .eq("id", email.id);

      if (error) throw error;

      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_CANCELLED",
          entityType: "email_outbox",
          entityId: email.id,
          metadata: {
            to_email: email.to_email,
            subject: email.subject,
            previous_status: email.status,
            attempts: email.attempts,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-outbox"] });
      toast.success("Correo cancelado");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Bulk retry
  const bulkRetry = useMutation({
    mutationFn: async () => {
      const failedIds = filteredEmails
        .filter(e => e.status === "FAILED")
        .map(e => e.id);

      if (failedIds.length === 0) return 0;

      const { error } = await supabase
        .from("email_outbox")
        .update({
          status: "PENDING",
          attempts: 0,
          error: null,
          next_attempt_at: new Date().toISOString(),
        })
        .in("id", failedIds);

      if (error) throw error;

      // Log audit for bulk retry
      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_BULK_RETRY",
          entityType: "email_outbox",
          metadata: {
            retried_count: failedIds.length,
            retried_ids: failedIds,
          },
        });
      }

      return failedIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-outbox"] });
      toast.success(`${count} correos fallidos programados para reenvío`);
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Stats
  const stats = {
    pending: emails?.filter(e => e.status === "PENDING").length || 0,
    sent: emails?.filter(e => e.status === "SENT").length || 0,
    failed: emails?.filter(e => e.status === "FAILED").length || 0,
    bounced: emails?.filter(e => e.status === "BOUNCED" || e.failure_type === "BOUNCE").length || 0,
    permanent: emails?.filter(e => e.failed_permanent === true).length || 0,
  };

  // Handler for retry with override check
  const handleRetryClick = (email: EmailOutboxItem) => {
    if (email.failed_permanent) {
      setEmailToRetryOverride(email);
      setRetryOverrideDialogOpen(true);
    } else {
      retryEmail.mutate(email);
    }
  };

  // Defensive check: if organization context is not ready
  if (!organization?.id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-amber-500" />
            Contexto de Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Cargando contexto de organización...
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              La gestión de correos está deshabilitada hasta que se cargue el contexto.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pendientes</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.sent}</p>
              <p className="text-xs text-muted-foreground">Enviados</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.failed}</p>
              <p className="text-xs text-muted-foreground">Fallidos</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
              <Ban className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.bounced}</p>
              <p className="text-xs text-muted-foreground">Rebotados</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Email List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Bandeja de Correos
              </CardTitle>
              <CardDescription>
                Gestiona los correos pendientes y revisa el historial
              </CardDescription>
            </div>
            {stats.failed > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkRetry.mutate()}
                disabled={bulkRetry.isPending}
              >
                {bulkRetry.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Reintentar Fallidos ({stats.failed})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email o asunto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="PENDING">Pendientes</SelectItem>
                <SelectItem value="SENT">Enviados</SelectItem>
                <SelectItem value="FAILED">Fallidos</SelectItem>
                <SelectItem value="BOUNCED">Rebotados</SelectItem>
                <SelectItem value="CANCELLED">Cancelados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={failureTypeFilter} onValueChange={setFailureTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tipo de Fallo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="BOUNCE">Rebotes</SelectItem>
                <SelectItem value="COMPLAINT">Quejas</SelectItem>
                <SelectItem value="SUPPRESSED">Suprimidos</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showPermanentOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowPermanentOnly(!showPermanentOnly)}
              className="gap-2"
            >
              <Ban className="h-4 w-4" />
              Permanentes ({stats.permanent})
            </Button>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay correos que mostrar</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Asunto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmails.map((email) => {
                  const statusConfig = STATUS_CONFIG[email.status] || STATUS_CONFIG.PENDING;
                  const StatusIcon = statusConfig.icon;

                  return (
                    <TableRow key={email.id}>
                      <TableCell className="font-medium">
                        {email.to_email}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {email.subject}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusConfig.className}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig.label}
                        </Badge>
                        {email.failed_permanent && (
                          <Badge variant="destructive" className="ml-1 text-xs">
                            {email.failure_type || "PERM"}
                          </Badge>
                        )}
                        {email.attempts > 0 && email.status === "FAILED" && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({email.attempts} intentos)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDistanceToNow(new Date(email.created_at), {
                          addSuffix: true,
                          locale: es,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedEmail(email)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {email.status === "FAILED" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRetryClick(email)}
                              disabled={retryEmail.isPending || retryOverrideMutation.isPending}
                              title={email.failed_permanent ? "Fallo permanente - requiere confirmación" : "Reintentar"}
                            >
                              <RotateCcw className={`h-4 w-4 ${email.failed_permanent ? "text-destructive" : ""}`} />
                            </Button>
                          )}
                          {email.status === "PENDING" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive">
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancelar Correo</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    ¿Estás seguro de que deseas cancelar este correo? No será enviado.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>No</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => cancelEmail.mutate(email)}>
                                    Cancelar Correo
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
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

      {/* Email Detail Dialog */}
      <Dialog open={!!selectedEmail} onOpenChange={() => setSelectedEmail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del Correo</DialogTitle>
            <DialogDescription>
              {selectedEmail?.to_email}
            </DialogDescription>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Asunto</p>
                  <p className="font-medium">{selectedEmail.subject}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Estado</p>
                  <Badge className={STATUS_CONFIG[selectedEmail.status]?.className}>
                    {STATUS_CONFIG[selectedEmail.status]?.label}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Creado</p>
                  <p>{format(new Date(selectedEmail.created_at), "dd MMM yyyy HH:mm", { locale: es })}</p>
                </div>
                {selectedEmail.sent_at && (
                  <div>
                    <p className="text-muted-foreground">Enviado</p>
                    <p>{format(new Date(selectedEmail.sent_at), "dd MMM yyyy HH:mm", { locale: es })}</p>
                  </div>
                )}
              </div>

              {selectedEmail.error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <p className="text-sm font-medium text-destructive mb-1">Último Error</p>
                  <p className="text-sm text-muted-foreground">{selectedEmail.error}</p>
                </div>
              )}

              {selectedEmail.failed_permanent && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-1">
                    ⚠️ Fallo Permanente ({selectedEmail.failure_type})
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Este correo no será reintentado automáticamente. Los futuros envíos a este destinatario pueden ser bloqueados.
                  </p>
                </div>
              )}

              {selectedEmail.provider_message_id && (
                <div className="text-xs text-muted-foreground">
                  <p>Provider ID: <code className="bg-muted px-1 rounded">{selectedEmail.provider_message_id}</code></p>
                  {selectedEmail.last_event_type && (
                    <p className="mt-1">Último evento: {selectedEmail.last_event_type} {selectedEmail.last_event_at && `(${format(new Date(selectedEmail.last_event_at), "dd MMM HH:mm", { locale: es })})`}</p>
                  )}
                </div>
              )}

              {selectedEmail.html && (
                <div className="border rounded-md p-4 bg-white dark:bg-gray-900 max-h-[300px] overflow-auto">
                  <div dangerouslySetInnerHTML={{ __html: selectedEmail.html }} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Retry Override Confirmation Dialog */}
      <AlertDialog open={retryOverrideDialogOpen} onOpenChange={setRetryOverrideDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Anular Fallo Permanente
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Este correo tiene un fallo permanente de tipo <strong>{emailToRetryOverride?.failure_type}</strong>.
              </p>
              {emailToRetryOverride?.failure_type === "BOUNCE" && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-300">⚠️ Advertencia de Rebote</p>
                  <p className="text-muted-foreground mt-1">
                    El servidor de destino rechazó este correo. Reintentar puede dañar la reputación del remitente.
                  </p>
                </div>
              )}
              {emailToRetryOverride?.failure_type === "COMPLAINT" && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">⚠️ Queja de Spam</p>
                  <p className="text-muted-foreground mt-1">
                    El destinatario marcó este correo como spam. No se recomienda reintentar.
                  </p>
                </div>
              )}
              <p>¿Estás seguro de que deseas anular este fallo y reintentar el envío?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEmailToRetryOverride(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => emailToRetryOverride && retryOverrideMutation.mutate(emailToRetryOverride)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={retryOverrideMutation.isPending}
            >
              {retryOverrideMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                "Anular y Reintentar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
