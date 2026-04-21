import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

type Job = {
  job_name: string;
  status?: string;
  estado?: string;
  last_run?: string;
  ultimo_run?: string;
  novedades?: number | string;
  novedades_encontradas?: number | string;
};

type SaludResponse = {
  ok: boolean;
  timestamp: string;
  jobs: Job[];
  radicados: {
    total: string | number;
    en_pp: string | number;
    en_cpnu: string | number;
    en_samai: string | number;
    en_samai_estados?: string | number;
    sin_monitoreo: string | number;
    sin_despacho: string | number;
    sin_workflow: string | number;
  };
  terminos: {
    vencidos: string | number;
    urgentes: string | number;
    proximos: string | number;
  };
  novedades_24h: Array<{ fuente: string; total: string | number }>;
  work_items_estado?: Array<{
    status?: string;
    monitoring_enabled?: boolean | string | null;
    pausado?: boolean | string | null;
    cerrado?: boolean | string | null;
    cpnu_status?: string | null;
    total: string | number;
  }>;
  sin_workflow?: Array<{
    radicado: string;
    despacho?: string | null;
    en_pp?: boolean | string | null;
    en_cpnu?: boolean | string | null;
    en_samai?: boolean | string | null;
  }>;
  sin_despacho?: Array<{
    radicado: string;
    workflow_type?: string | null;
    en_pp?: boolean | string | null;
    en_cpnu?: boolean | string | null;
    en_samai?: boolean | string | null;
  }>;
};

const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
};

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["true", "t", "1", "yes", "si", "sí"].includes(v.toLowerCase());
  return false;
};

function PortalBadges({
  pp,
  cpnu,
  samai,
}: {
  pp?: unknown;
  cpnu?: unknown;
  samai?: unknown;
}) {
  const items: Array<{ label: string; on: boolean }> = [
    { label: "PP", on: toBool(pp) },
    { label: "CPNU", on: toBool(cpnu) },
    { label: "SAMAI", on: toBool(samai) },
  ];
  return (
    <div className="flex gap-1">
      {items.map((i) => (
        <Badge
          key={i.label}
          variant="outline"
          className={
            i.on
              ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
              : "border-muted-foreground/30 text-muted-foreground bg-muted/30"
          }
        >
          {i.label}
        </Badge>
      ))}
    </div>
  );
}

async function fetchSalud(): Promise<SaludResponse> {
  const res = await fetch(`${ANDROMEDA_API_BASE}/salud`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function StatCard({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
  hint?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
      ? "text-amber-500"
      : tone === "success"
      ? "text-emerald-500"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-3xl font-display font-semibold mt-1 ${toneClass}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function SistemaSalud() {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["sistema-salud"],
    queryFn: fetchSalud,
    refetchInterval: 60_000,
  });

  const r = data?.radicados;
  const t = data?.terminos;
  const jobs = data?.jobs ?? [];
  const novedades = data?.novedades_24h ?? [];
  const workItemsEstado = data?.work_items_estado ?? [];
  const sinWorkflow = data?.sin_workflow ?? [];
  const sinDespacho = data?.sin_despacho ?? [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-display font-semibold">Salud del Sistema</h1>
            <p className="text-sm text-muted-foreground">
              Estado en tiempo real de jobs, radicados, términos y novedades.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              Actualizado hace {formatDistanceToNow(new Date(dataUpdatedAt), { locale: es })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div className="text-sm">
              No se pudo consultar el endpoint de salud: {(error as Error)?.message}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado de Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado de Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              Los jobs registrarán su estado esta noche.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último run</TableHead>
                  <TableHead className="text-right">Novedades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j, idx) => {
                  const status = (j.status ?? j.estado ?? "").toUpperCase();
                  const ok = status === "OK" || status === "SUCCESS";
                  const lastRun = j.last_run ?? j.ultimo_run;
                  const nov = j.novedades_encontradas ?? j.novedades ?? 0;
                  return (
                    <TableRow key={`${j.job_name}-${idx}`}>
                      <TableCell className="font-medium">{j.job_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            ok
                              ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
                              : "border-destructive/40 text-destructive bg-destructive/10"
                          }
                        >
                          {ok ? (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          ) : (
                            <XCircle className="h-3 w-3 mr-1" />
                          )}
                          {status || "DESCONOCIDO"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {lastRun
                          ? formatDistanceToNow(new Date(lastRun), { locale: es, addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{toNum(nov)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Estado de Radicados */}
      <div>
        <h2 className="text-lg font-display font-semibold mb-3">Estado de Radicados</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Total activos" value={toNum(r?.total)} />
          <StatCard label="En PP" value={toNum(r?.en_pp)} tone="success" />
          <StatCard label="En CPNU" value={toNum(r?.en_cpnu)} tone="success" />
          <StatCard label="En SAMAI" value={toNum(r?.en_samai)} tone="success" />
          <StatCard
            label="Sin monitoreo"
            value={toNum(r?.sin_monitoreo)}
            tone={toNum(r?.sin_monitoreo) > 0 ? "danger" : "muted"}
          />
          <StatCard
            label="Sin despacho"
            value={toNum(r?.sin_despacho)}
            tone={toNum(r?.sin_despacho) > 0 ? "warning" : "muted"}
          />
          <StatCard
            label="Sin workflow"
            value={toNum(r?.sin_workflow)}
            tone={toNum(r?.sin_workflow) > 0 ? "danger" : "muted"}
          />
        </div>
      </div>

      {/* Términos Procesales */}
      <div>
        <h2 className="text-lg font-display font-semibold mb-3">Términos Procesales</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Vencidos"
            value={toNum(t?.vencidos)}
            tone={toNum(t?.vencidos) > 0 ? "danger" : "muted"}
          />
          <StatCard
            label="Urgentes"
            value={toNum(t?.urgentes)}
            tone={toNum(t?.urgentes) > 0 ? "warning" : "muted"}
            hint="≤ 2 días hábiles"
          />
          <StatCard
            label="Próximos"
            value={toNum(t?.proximos)}
            tone={toNum(t?.proximos) > 0 ? "warning" : "muted"}
            hint="3 a 5 días hábiles"
          />
        </div>
      </div>

      {/* Novedades últimas 24h */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Novedades últimas 24h</CardTitle>
        </CardHeader>
        <CardContent>
          {novedades.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin novedades en las últimas 24 horas.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {novedades.map((n) => (
                <Badge
                  key={n.fuente}
                  variant="secondary"
                  className="text-sm py-1.5 px-3"
                >
                  {n.fuente}
                  <span className="ml-2 font-bold tabular-nums">{toNum(n.total)}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Estado de Work Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estado de Work Items</CardTitle>
        </CardHeader>
        <CardContent>
          {workItemsEstado.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin datos de work items.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Monitoreo</TableHead>
                  <TableHead>Pausado</TableHead>
                  <TableHead>Cerrado</TableHead>
                  <TableHead>CPNU Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workItemsEstado.map((w, idx) => {
                  const status = (w.status ?? "").toUpperCase();
                  const cpnuStatus = (w.cpnu_status ?? "").toUpperCase();
                  const isActiveSuccess = status === "ACTIVE" && cpnuStatus === "SUCCESS";
                  const isNotFound = cpnuStatus === "NOT_FOUND";
                  const isDeleted = status === "DELETED";
                  const tone = isDeleted
                    ? "border-destructive/40 text-destructive bg-destructive/10"
                    : isActiveSuccess
                    ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
                    : isNotFound
                    ? "border-amber-500/40 text-amber-500 bg-amber-500/10"
                    : "border-muted-foreground/30 text-muted-foreground bg-muted/30";
                  return (
                    <TableRow key={idx}>
                      <TableCell>
                        <Badge variant="outline" className={tone}>
                          {status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {toBool(w.monitoring_enabled) ? "Sí" : "No"}
                      </TableCell>
                      <TableCell className="text-sm">{toBool(w.pausado) ? "Sí" : "No"}</TableCell>
                      <TableCell className="text-sm">{toBool(w.cerrado) ? "Sí" : "No"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {cpnuStatus || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {toNum(w.total)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Radicados con problemas */}
      <div>
        <h2 className="text-lg font-display font-semibold mb-3">Radicados con problemas</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Sin workflow_type</span>
                <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10">
                  {sinWorkflow.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sinWorkflow.length === 0 ? (
                <div className="text-sm text-muted-foreground">Todos los radicados tienen workflow asignado.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Despacho</TableHead>
                      <TableHead>Portales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sinWorkflow.map((row, idx) => (
                      <TableRow key={`${row.radicado}-${idx}`}>
                        <TableCell className="font-mono text-xs">{row.radicado}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.despacho || "—"}
                        </TableCell>
                        <TableCell>
                          <PortalBadges pp={row.en_pp} cpnu={row.en_cpnu} samai={row.en_samai} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Sin despacho</span>
                <Badge variant="outline" className="border-amber-500/40 text-amber-500 bg-amber-500/10">
                  {sinDespacho.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sinDespacho.length === 0 ? (
                <div className="text-sm text-muted-foreground">Todos los radicados tienen despacho asignado.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Workflow</TableHead>
                      <TableHead>Portales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sinDespacho.map((row, idx) => (
                      <TableRow key={`${row.radicado}-${idx}`}>
                        <TableCell className="font-mono text-xs">{row.radicado}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.workflow_type || "—"}
                        </TableCell>
                        <TableCell>
                          <PortalBadges pp={row.en_pp} cpnu={row.en_cpnu} samai={row.en_samai} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
