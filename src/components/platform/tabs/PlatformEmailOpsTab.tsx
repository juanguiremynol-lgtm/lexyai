/**
 * Platform Email Ops Tab - Global email outbox overview
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, AlertTriangle, CheckCircle2, Clock, XCircle, Building2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface EmailWithOrg {
  id: string;
  organization_id: string;
  organization_name?: string;
  to_email: string;
  subject: string;
  status: string;
  failed_permanent: boolean;
  failure_type: string | null;
  last_event_type: string | null;
  attempts: number;
  created_at: string;
}

export function PlatformEmailOpsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["platform-email-outbox", statusFilter, orgFilter],
    queryFn: async () => {
      let query = supabase
        .from("email_outbox")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (orgFilter !== "all") {
        query = query.eq("organization_id", orgFilter);
      }

      const { data: emails, error } = await query;
      if (error) throw error;

      // Get organization names
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name");

      const orgMap = new Map(orgs?.map((o) => [o.id, o.name]) || []);

      // Stats
      const stats = {
        total: 0,
        pending: 0,
        sent: 0,
        failed: 0,
        permanentFailures: 0,
      };

      const emailsWithOrg = (emails || []).map((email) => {
        stats.total++;
        if (email.status === "pending") stats.pending++;
        if (email.status === "sent") stats.sent++;
        if (email.status === "failed") stats.failed++;
        if (email.failed_permanent) stats.permanentFailures++;

        return {
          ...email,
          organization_name: orgMap.get(email.organization_id) || "Desconocida",
        };
      }) as EmailWithOrg[];

      // Permanent failures by org
      const permanentByOrg = new Map<string, number>();
      emailsWithOrg.forEach((e) => {
        if (e.failed_permanent) {
          const count = permanentByOrg.get(e.organization_name || "") || 0;
          permanentByOrg.set(e.organization_name || "", count + 1);
        }
      });

      return {
        emails: emailsWithOrg,
        stats,
        permanentByOrg: Array.from(permanentByOrg.entries()).sort((a, b) => b[1] - a[1]),
        organizations: orgs || [],
      };
    },
  });

  const getStatusIcon = (status: string, isPermanent: boolean) => {
    if (isPermanent) return <XCircle className="h-4 w-4 text-red-500" />;
    switch (status) {
      case "sent":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-blue-500" />;
      case "failed":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Mail className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: string, isPermanent: boolean) => {
    if (isPermanent) {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Falla Permanente</Badge>;
    }
    switch (status) {
      case "sent":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Enviado</Badge>;
      case "pending":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Pendiente</Badge>;
      case "failed":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Fallido</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando bandeja de correos...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.total || 0}</div>
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.pending || 0}</div>
                <p className="text-sm text-muted-foreground">Pendientes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.sent || 0}</div>
                <p className="text-sm text-muted-foreground">Enviados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.failed || 0}</div>
                <p className="text-sm text-muted-foreground">Fallidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{data?.stats.permanentFailures || 0}</div>
                <p className="text-sm text-muted-foreground">Permanentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Permanent Failures by Org */}
      {data?.permanentByOrg && data.permanentByOrg.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Fallas Permanentes por Organización
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.permanentByOrg.map(([orgName, count]) => (
                <Badge key={orgName} variant="destructive">
                  {orgName}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Bandeja de Correos Global
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="sent">Enviados</SelectItem>
                <SelectItem value="failed">Fallidos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Organización" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las organizaciones</SelectItem>
                {data?.organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            {data?.emails.map((email) => (
              <div
                key={email.id}
                className="p-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {getStatusIcon(email.status, email.failed_permanent)}
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{email.to_email}</span>
                      {getStatusBadge(email.status, email.failed_permanent)}
                      {email.failure_type && (
                        <Badge variant="outline">{email.failure_type}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {email.subject}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {email.organization_name}
                      </span>
                      <span>Intentos: {email.attempts}</span>
                      {email.last_event_type && (
                        <span>Último evento: {email.last_event_type}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(email.created_at), "dd MMM HH:mm", { locale: es })}
                  </span>
                </div>
              </div>
            ))}

            {(!data?.emails || data.emails.length === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No hay correos que coincidan con los filtros
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
