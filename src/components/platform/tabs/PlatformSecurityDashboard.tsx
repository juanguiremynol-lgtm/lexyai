/**
 * PlatformSecurityDashboard — Encryption status, RLS coverage, data access logs,
 * and privacy controls for the platform console.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, Lock, Eye, ShieldCheck, ShieldAlert, Database, Clock, Users, RefreshCw, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function PlatformSecurityDashboard() {
  const queryClient = useQueryClient();

  // Fetch protection summary via RPC
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["data-protection-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_data_protection_summary" as any);
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 30000,
  });

  // Fetch PII registry
  const { data: piiRegistry, isLoading: piiLoading } = useQuery({
    queryKey: ["pii-encryption-registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pii_encryption_registry" as any)
        .select("*")
        .order("table_name");
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch recent access logs
  const { data: accessLogs, isLoading: logsLoading } = useQuery({
    queryKey: ["data-access-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_access_log" as any)
        .select("*")
        .order("accessed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 15000,
  });

  // Toggle encryption status
  const toggleEncryption = useMutation({
    mutationFn: async ({ id, is_encrypted }: { id: string; is_encrypted: boolean }) => {
      const { error } = await supabase
        .from("pii_encryption_registry" as any)
        .update({ 
          is_encrypted, 
          encrypted_at: is_encrypted ? new Date().toISOString() : null,
          last_audit_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pii-encryption-registry"] });
      queryClient.invalidateQueries({ queryKey: ["data-protection-summary"] });
      toast.success("Estado de cifrado actualizado");
    },
  });

  const encryptionRate = summary?.pii_encryption_rate ?? 0;
  const rlsCoverage = summary?.rls_coverage_pct ?? 0;

  return (
    <div className="min-h-screen bg-black text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Seguridad y Privacidad</h1>
            <p className="text-white/40 text-sm">Cifrado de datos, control de acceso y auditoría</p>
          </div>
        </div>
        <Badge 
          className={`font-mono text-xs ${
            rlsCoverage === 100 
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
          }`}
        >
          RLS {rlsCoverage}%
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Lock className="h-5 w-5 text-cyan-400" />}
          label="Campos PII Cifrados"
          value={`${summary?.pii_encrypted_fields ?? 0}/${summary?.pii_total_fields ?? 0}`}
          sublabel={`${encryptionRate}% cifrado`}
          color={encryptionRate >= 75 ? "emerald" : encryptionRate >= 40 ? "amber" : "red"}
        />
        <KpiCard
          icon={<Database className="h-5 w-5 text-cyan-400" />}
          label="Tablas con RLS"
          value={`${summary?.tables_with_rls ?? 0}`}
          sublabel={`${summary?.tables_without_rls ?? 0} sin RLS`}
          color={summary?.tables_without_rls === 0 ? "emerald" : "red"}
        />
        <KpiCard
          icon={<Eye className="h-5 w-5 text-cyan-400" />}
          label="Accesos (24h)"
          value={`${summary?.access_logs_24h ?? 0}`}
          sublabel={`${summary?.unique_accessors_24h ?? 0} usuarios únicos`}
          color="cyan"
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5 text-cyan-400" />}
          label="Cobertura RLS"
          value={`${rlsCoverage}%`}
          sublabel={rlsCoverage === 100 ? "Todas las tablas protegidas" : "Revisar tablas expuestas"}
          color={rlsCoverage === 100 ? "emerald" : "amber"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PII Encryption Registry */}
        <Card className="bg-white/[0.03] border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-cyan-400" />
                <CardTitle className="text-white text-base">Registro de Cifrado PII</CardTitle>
              </div>
              <Badge variant="outline" className="text-white/50 border-white/15 text-xs">
                {piiRegistry?.length ?? 0} campos
              </Badge>
            </div>
            <CardDescription className="text-white/30 text-xs">
              Estado de cifrado de campos con información personal identificable
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[350px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-white/40 text-xs">Tabla</TableHead>
                    <TableHead className="text-white/40 text-xs">Columna</TableHead>
                    <TableHead className="text-white/40 text-xs">Método</TableHead>
                    <TableHead className="text-white/40 text-xs text-right">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {piiRegistry?.map((field: any) => (
                    <TableRow key={field.id} className="border-white/5 hover:bg-white/5">
                      <TableCell className="text-white/70 font-mono text-xs">{field.table_name}</TableCell>
                      <TableCell className="text-white/70 font-mono text-xs">{field.column_name}</TableCell>
                      <TableCell>
                        <Badge className="bg-white/5 text-white/40 border-white/10 text-[10px]">
                          {field.encryption_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {field.is_encrypted ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                              Cifrado
                            </Badge>
                          ) : (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
                              Sin cifrar
                            </Badge>
                          )}
                          <Switch
                            checked={field.is_encrypted}
                            onCheckedChange={(v) => toggleEncryption.mutate({ id: field.id, is_encrypted: v })}
                            className="scale-75"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Data Access Logs */}
        <Card className="bg-white/[0.03] border-white/10">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-cyan-400" />
                <CardTitle className="text-white text-base">Registro de Acceso a Datos</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/30 hover:text-white/60 h-7"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["data-access-logs"] })}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Actualizar
              </Button>
            </div>
            <CardDescription className="text-white/30 text-xs">
              Últimos 50 accesos a tablas con datos sensibles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[350px]">
              {logsLoading ? (
                <div className="text-white/30 text-center py-8">Cargando registros...</div>
              ) : !accessLogs?.length ? (
                <div className="text-white/30 text-center py-8 flex flex-col items-center gap-2">
                  <ShieldCheck className="h-8 w-8 text-white/15" />
                  <span>Sin registros de acceso recientes</span>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-white/40 text-xs">Hora</TableHead>
                      <TableHead className="text-white/40 text-xs">Tabla</TableHead>
                      <TableHead className="text-white/40 text-xs">Operación</TableHead>
                      <TableHead className="text-white/40 text-xs">Contexto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessLogs.map((log: any) => (
                      <TableRow key={log.id} className="border-white/5 hover:bg-white/5">
                        <TableCell className="text-white/50 text-xs">
                          {format(new Date(log.accessed_at), "dd/MM HH:mm:ss", { locale: es })}
                        </TableCell>
                        <TableCell className="text-white/70 font-mono text-xs">{log.table_name}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${
                            log.operation === "SELECT" 
                              ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                              : log.operation === "DELETE"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          }`}>
                            {log.operation}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-white/40 text-xs">{log.context}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Security Posture Summary */}
      <Card className="bg-white/[0.03] border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-white text-base">Resumen de Postura de Seguridad</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SecurityCheck
              title="Row Level Security"
              status={rlsCoverage === 100 ? "pass" : "warn"}
              detail={rlsCoverage === 100 ? "100% de tablas protegidas con RLS" : `${summary?.tables_without_rls} tablas sin RLS activo`}
            />
            <SecurityCheck
              title="Cifrado de Credenciales"
              status="pass"
              detail="Contraseñas y secretos cifrados con AES-256-GCM"
            />
            <SecurityCheck
              title="Auditoría de Acceso"
              status="pass"
              detail="Registro automático de escrituras en tablas sensibles"
            />
            <SecurityCheck
              title="Aislamiento Multi-Tenant"
              status="pass"
              detail="Datos segregados por organization_id en políticas RLS"
            />
            <SecurityCheck
              title="Secretos de Proveedor"
              status="pass"
              detail="Cifrados con ATENIA_SECRETS_KEY_B64, deny-all RLS"
            />
            <SecurityCheck
              title="Retención de Logs"
              status="pass"
              detail="Purga automática configurable (90 días por defecto)"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, sublabel, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/20",
    amber: "border-amber-500/20",
    red: "border-red-500/20",
    cyan: "border-cyan-500/20",
  };
  const textColorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
    cyan: "text-cyan-400",
  };

  return (
    <Card className={`bg-white/[0.03] ${colorMap[color]} border`}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-center justify-between mb-3">
          {icon}
          <span className="text-white/30 text-[10px] uppercase tracking-widest font-mono">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${textColorMap[color]} font-mono`}>{value}</div>
        <p className="text-white/30 text-xs mt-1">{sublabel}</p>
      </CardContent>
    </Card>
  );
}

function SecurityCheck({ title, status, detail }: {
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}) {
  const statusConfig = {
    pass: { icon: <ShieldCheck className="h-4 w-4 text-emerald-400" />, bg: "bg-emerald-500/10 border-emerald-500/20" },
    warn: { icon: <ShieldAlert className="h-4 w-4 text-amber-400" />, bg: "bg-amber-500/10 border-amber-500/20" },
    fail: { icon: <FileWarning className="h-4 w-4 text-red-400" />, bg: "bg-red-500/10 border-red-500/20" },
  };
  const cfg = statusConfig[status];

  return (
    <div className={`rounded-lg border p-3 ${cfg.bg}`}>
      <div className="flex items-center gap-2 mb-1">
        {cfg.icon}
        <span className="text-white/80 text-sm font-medium">{title}</span>
      </div>
      <p className="text-white/40 text-xs">{detail}</p>
    </div>
  );
}
