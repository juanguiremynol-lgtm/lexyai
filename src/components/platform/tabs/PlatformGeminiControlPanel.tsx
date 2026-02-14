/**
 * PlatformGeminiControlPanel — Gemini AI usage counters and governance switches
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Zap, ShieldAlert, Users, Crown, Power, Activity, TrendingUp, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

type TimeRange = "24h" | "7d" | "30d";

interface GeminiSettings {
  gemini_master_enabled: boolean;
  gemini_user_enabled: boolean;
  gemini_org_admin_enabled: boolean;
  gemini_super_admin_enabled: boolean;
}

interface CallLogRow {
  id: string;
  created_at: string;
  caller_type: string;
  function_name: string;
  model: string;
  tokens_used: number | null;
  duration_ms: number | null;
  status: string;
}

const CALLER_COLORS: Record<string, string> = {
  USER: "hsl(var(--primary))",
  ORG_ADMIN: "hsl(var(--accent-foreground))",
  SUPER_ADMIN: "hsl(45, 93%, 47%)",
  SYSTEM: "hsl(var(--muted-foreground))",
};

const CALLER_LABELS: Record<string, string> = {
  USER: "Usuarios",
  ORG_ADMIN: "Admin Org",
  SUPER_ADMIN: "Super Admin",
  SYSTEM: "Sistema",
};

function getTimeFilter(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case "24h": return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
}

export function PlatformGeminiControlPanel() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const queryClient = useQueryClient();

  // Fetch platform settings
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["platform-gemini-settings"],
    queryFn: async (): Promise<GeminiSettings> => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("gemini_master_enabled, gemini_user_enabled, gemini_org_admin_enabled, gemini_super_admin_enabled")
        .eq("id", "singleton")
        .maybeSingle();
      if (error) throw error;
      return {
        gemini_master_enabled: data?.gemini_master_enabled ?? true,
        gemini_user_enabled: data?.gemini_user_enabled ?? true,
        gemini_org_admin_enabled: data?.gemini_org_admin_enabled ?? true,
        gemini_super_admin_enabled: data?.gemini_super_admin_enabled ?? true,
      };
    },
  });

  // Fetch call logs
  const { data: callLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["gemini-call-logs", timeRange],
    queryFn: async (): Promise<CallLogRow[]> => {
      const since = getTimeFilter(timeRange);
      const { data, error } = await supabase
        .from("gemini_call_log")
        .select("id, created_at, caller_type, function_name, model, tokens_used, duration_ms, status")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as CallLogRow[];
    },
  });

  // Mutation for updating settings
  const updateSetting = useMutation({
    mutationFn: async (updates: Partial<GeminiSettings>) => {
      const { error } = await supabase
        .from("platform_settings")
        .update(updates)
        .eq("id", "singleton");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-gemini-settings"] });
      toast.success("Configuración de Gemini actualizada");
    },
    onError: (err) => {
      toast.error("Error actualizando configuración: " + (err as Error).message);
    },
  });

  // Compute stats
  const totalCalls = callLogs.length;
  const errorCalls = callLogs.filter(c => c.status === "ERROR").length;
  const rateLimited = callLogs.filter(c => c.status === "RATE_LIMITED").length;
  const avgDuration = callLogs.length > 0
    ? Math.round(callLogs.reduce((s, c) => s + (c.duration_ms ?? 0), 0) / callLogs.length)
    : 0;

  // By caller type
  const byCallerType = Object.entries(
    callLogs.reduce((acc, c) => {
      acc[c.caller_type] = (acc[c.caller_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: CALLER_LABELS[name] || name, value, key: name }));

  // By function
  const byFunction = Object.entries(
    callLogs.reduce((acc, c) => {
      acc[c.function_name] = (acc[c.function_name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.replace(/-/g, " "), count }));

  // Daily trend
  const dailyTrend = Object.entries(
    callLogs.reduce((acc, c) => {
      const day = c.created_at.slice(0, 10);
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, calls]) => ({ date: date.slice(5), calls }));

  const masterEnabled = settings?.gemini_master_enabled ?? true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Control de Gemini AI
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoreo de uso y control granular de llamadas a la IA
          </p>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Últimas 24h</SelectItem>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Master Kill Switch */}
      <Card className={`border-2 ${masterEnabled ? "border-primary/20" : "border-destructive/40 bg-destructive/5"}`}>
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Power className={`h-6 w-6 ${masterEnabled ? "text-primary" : "text-destructive"}`} />
            <div>
              <p className="font-semibold text-lg">Kill Switch Global</p>
              <p className="text-sm text-muted-foreground">
                {masterEnabled
                  ? "✅ Gemini activo — todas las integraciones de IA están operativas"
                  : "⛔ Gemini DESACTIVADO — todas las llamadas a la IA están suspendidas globalmente"}
              </p>
            </div>
          </div>
          <Switch
            checked={masterEnabled}
            onCheckedChange={(v) => updateSetting.mutate({ gemini_master_enabled: v })}
            disabled={settingsLoading || updateSetting.isPending}
          />
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground font-medium">Total Llamadas</p>
            </div>
            <p className="text-2xl font-bold">{logsLoading ? "..." : totalCalls.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-xs text-muted-foreground font-medium">Errores</p>
            </div>
            <p className="text-2xl font-bold">{logsLoading ? "..." : errorCalls}</p>
            {totalCalls > 0 && (
              <p className="text-xs text-muted-foreground">{((errorCalls / totalCalls) * 100).toFixed(1)}%</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="h-4 w-4 text-accent-foreground" />
              <p className="text-xs text-muted-foreground font-medium">Rate Limited</p>
            </div>
            <p className="text-2xl font-bold">{logsLoading ? "..." : rateLimited}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground font-medium">Latencia Prom.</p>
            </div>
            <p className="text-2xl font-bold">{logsLoading ? "..." : `${avgDuration}ms`}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Tendencia de Llamadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" className="text-xs fill-muted-foreground" />
                  <YAxis className="text-xs fill-muted-foreground" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-10">Sin datos en el período seleccionado</p>
            )}
          </CardContent>
        </Card>

        {/* By Caller Type Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Distribución por Rol
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byCallerType.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={220}>
                  <PieChart>
                    <Pie data={byCallerType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                      {byCallerType.map((entry) => (
                        <Cell key={entry.key} fill={CALLER_COLORS[entry.key] || "hsl(var(--muted))"} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2">
                  {byCallerType.map((entry) => (
                    <div key={entry.key} className="flex items-center gap-2 text-sm">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: CALLER_COLORS[entry.key] }}
                      />
                      <span className="text-muted-foreground">{entry.name}:</span>
                      <span className="font-medium">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-10">Sin datos</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Functions */}
      {byFunction.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Funciones por Llamadas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, byFunction.length * 36)}>
              <BarChart data={byFunction} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" className="text-xs fill-muted-foreground" />
                <YAxis type="category" dataKey="name" className="text-xs fill-muted-foreground" width={110} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Granular Switches */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Control Granular por Rol
          </CardTitle>
          <CardDescription>
            Activa o desactiva llamadas a Gemini para cada tipo de usuario. El kill switch global tiene prioridad.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!masterEnabled && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-sm text-destructive font-medium">
                El kill switch global está desactivado. Ningún rol puede usar Gemini.
              </p>
            </div>
          )}

          {/* User switch */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <Label className="font-medium">Usuarios Comunes</Label>
                <p className="text-xs text-muted-foreground">
                  Lexy AI, análisis de asuntos, resumen diario
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={settings?.gemini_user_enabled && masterEnabled ? "default" : "secondary"}>
                {settings?.gemini_user_enabled && masterEnabled ? "Activo" : "Inactivo"}
              </Badge>
              <Switch
                checked={settings?.gemini_user_enabled ?? true}
                onCheckedChange={(v) => updateSetting.mutate({ gemini_user_enabled: v })}
                disabled={!masterEnabled || settingsLoading || updateSetting.isPending}
              />
            </div>
          </div>

          {/* Org Admin switch */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-accent-foreground" />
              <div>
                <Label className="font-medium">Administradores de Organización</Label>
                <p className="text-xs text-muted-foreground">
                  Diagnósticos de organización, auditorías internas
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={settings?.gemini_org_admin_enabled && masterEnabled ? "default" : "secondary"}>
                {settings?.gemini_org_admin_enabled && masterEnabled ? "Activo" : "Inactivo"}
              </Badge>
              <Switch
                checked={settings?.gemini_org_admin_enabled ?? true}
                onCheckedChange={(v) => updateSetting.mutate({ gemini_org_admin_enabled: v })}
                disabled={!masterEnabled || settingsLoading || updateSetting.isPending}
              />
            </div>
          </div>

          {/* Super Admin switch */}
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              <div>
                <Label className="font-medium">Super Administradores</Label>
                <p className="text-xs text-muted-foreground">
                  Lexy Analysis, Master Sync Analysis, auditorías de plataforma
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={settings?.gemini_super_admin_enabled && masterEnabled ? "default" : "secondary"}>
                {settings?.gemini_super_admin_enabled && masterEnabled ? "Activo" : "Inactivo"}
              </Badge>
              <Switch
                checked={settings?.gemini_super_admin_enabled ?? true}
                onCheckedChange={(v) => updateSetting.mutate({ gemini_super_admin_enabled: v })}
                disabled={!masterEnabled || settingsLoading || updateSetting.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
