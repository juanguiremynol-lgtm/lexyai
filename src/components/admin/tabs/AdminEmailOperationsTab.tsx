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
}

export function AdminEmailOperationsTab() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<EmailOutboxItem | null>(null);

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

  // Filter by search
  const filteredEmails = emails?.filter(email =>
    !searchQuery ||
    email.to_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    email.subject.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Retry failed email
  const retryEmail = useMutation({
    mutationFn: async (emailId: string) => {
      const { error } = await supabase
        .from("email_outbox")
        .update({
          status: "PENDING",
          attempts: 0,
          error: null,
          next_attempt_at: new Date().toISOString(),
        })
        .eq("id", emailId);

      if (error) throw error;

      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_RETRY",
          entityType: "email_outbox",
          entityId: emailId,
          metadata: {},
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

  // Cancel pending email
  const cancelEmail = useMutation({
    mutationFn: async (emailId: string) => {
      const { error } = await supabase
        .from("email_outbox")
        .update({ status: "CANCELLED" })
        .eq("id", emailId);

      if (error) throw error;

      if (organization?.id) {
        await logAudit({
          organizationId: organization.id,
          action: "EMAIL_CANCELLED",
          entityType: "email_outbox",
          entityId: emailId,
          metadata: {},
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

      if (failedIds.length === 0) return;

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-outbox"] });
      toast.success("Correos fallidos programados para reenvío");
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
    bounced: emails?.filter(e => e.status === "BOUNCED").length || 0,
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
                              onClick={() => retryEmail.mutate(email.id)}
                              disabled={retryEmail.isPending}
                            >
                              <RotateCcw className="h-4 w-4" />
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
                                  <AlertDialogAction onClick={() => cancelEmail.mutate(email.id)}>
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

              {selectedEmail.html && (
                <div className="border rounded-md p-4 bg-white dark:bg-gray-900 max-h-[300px] overflow-auto">
                  <div dangerouslySetInnerHTML={{ __html: selectedEmail.html }} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
