/**
 * Billing Accounting Section — Export transactions for accounting (CSV / Excel)
 * with date range, organization, plan, and status filters.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  FileSpreadsheet,
  Download,
  Filter,
  CalendarDays,
  Building2,
  Search,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCOP(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const statusStyle: Record<string, string> = {
  COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  PENDING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  CANCELED: "bg-red-500/20 text-red-400 border-red-500/30",
  EXPIRED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  PAID: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DRAFT: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  VOID: "bg-red-500/20 text-red-400 border-red-500/30",
  UNCOLLECTIBLE: "bg-red-500/20 text-red-300 border-red-500/30",
};

const statusLabel: Record<string, string> = {
  COMPLETED: "Completada",
  PENDING: "Pendiente",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
  PAID: "Pagada",
  OPEN: "Abierta",
  DRAFT: "Borrador",
  VOID: "Anulada",
  UNCOLLECTIBLE: "Incobrable",
};

type SourceType = "all" | "sessions" | "invoices";

interface AccountingRow {
  id: string;
  source: "session" | "invoice";
  date: string;
  org_id: string;
  org_name: string;
  plan: string;
  cycle_months: number | null;
  amount_cop: number | null;
  discount_cop: number | null;
  net_amount_cop: number | null;
  currency: string;
  status: string;
  provider: string;
  provider_ref: string | null;
  period_start: string | null;
  period_end: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BillingAccountingSection() {
  // Filter state
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceFilter, setSourceFilter] = useState<SourceType>("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orgSearch, setOrgSearch] = useState("");

  // ---- Fetch data ----
  const { data: rows, isLoading } = useQuery({
    queryKey: ["platform-accounting", dateFrom, dateTo],
    queryFn: async () => {
      const from = `${dateFrom}T00:00:00Z`;
      const to = `${dateTo}T23:59:59Z`;

      const [sessionsRes, invoicesRes, orgsRes, plansRes] = await Promise.all([
        (supabase.from("billing_checkout_sessions") as any)
          .select("id, organization_id, tier, status, provider, provider_session_id, billing_cycle_months, amount_cop_incl_iva, discount_amount_cop, created_at")
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: false })
          .limit(2000),
        (supabase.from("billing_invoices") as any)
          .select("id, organization_id, provider, provider_invoice_id, amount_cop_incl_iva, discount_amount_cop, currency, status, period_start, period_end, created_at, metadata")
          .gte("created_at", from)
          .lte("created_at", to)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.from("organizations").select("id, name"),
        (supabase.from("billing_plans") as any).select("code, display_name"),
      ]);

      const orgMap = new Map((orgsRes.data || []).map((o: any) => [o.id, o.name]));
      const planMap = new Map((plansRes.data || []).map((p: any) => [p.code, p.display_name]));

      const result: AccountingRow[] = [];

      for (const s of sessionsRes.data || []) {
        const discount = s.discount_amount_cop ?? 0;
        const amount = s.amount_cop_incl_iva ?? 0;
        result.push({
          id: s.id,
          source: "session",
          date: s.created_at,
          org_id: s.organization_id,
          org_name: orgMap.get(s.organization_id) || "—",
          plan: s.tier || "—",
          cycle_months: s.billing_cycle_months,
          amount_cop: amount,
          discount_cop: discount,
          net_amount_cop: amount - discount,
          currency: "COP",
          status: s.status,
          provider: s.provider || "—",
          provider_ref: s.provider_session_id,
          period_start: null,
          period_end: null,
        });
      }

      for (const inv of invoicesRes.data || []) {
        const discount = inv.discount_amount_cop ?? 0;
        const amount = inv.amount_cop_incl_iva ?? 0;
        // Try to get plan from metadata
        const plan = (inv.metadata as any)?.plan_code || (inv.metadata as any)?.tier || "—";
        result.push({
          id: inv.id,
          source: "invoice",
          date: inv.created_at,
          org_id: inv.organization_id,
          org_name: orgMap.get(inv.organization_id) || "—",
          plan,
          cycle_months: null,
          amount_cop: amount,
          discount_cop: discount,
          net_amount_cop: amount - discount,
          currency: inv.currency || "COP",
          status: inv.status,
          provider: inv.provider || "—",
          provider_ref: inv.provider_invoice_id,
          period_start: inv.period_start,
          period_end: inv.period_end,
        });
      }

      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return { rows: result, planMap };
    },
    staleTime: 30_000,
  });

  // ---- Derived: unique values for filters ----
  const allRows = rows?.rows ?? [];
  const planOptions = useMemo(() => [...new Set(allRows.map((r) => r.plan))].sort(), [allRows]);
  const statusOptions = useMemo(() => [...new Set(allRows.map((r) => r.status))].sort(), [allRows]);

  // ---- Apply client-side filters ----
  const filtered = useMemo(() => {
    let result = allRows;
    if (sourceFilter !== "all") {
      const src = sourceFilter === "sessions" ? "session" : "invoice";
      result = result.filter((r) => r.source === src);
    }
    if (planFilter !== "all") result = result.filter((r) => r.plan === planFilter);
    if (statusFilter !== "all") result = result.filter((r) => r.status === statusFilter);
    if (orgSearch.trim()) {
      const q = orgSearch.toLowerCase();
      result = result.filter((r) => r.org_name.toLowerCase().includes(q));
    }
    return result;
  }, [allRows, sourceFilter, planFilter, statusFilter, orgSearch]);

  // ---- Totals ----
  const totalAmount = filtered.reduce((s, r) => s + (r.net_amount_cop ?? 0), 0);
  const totalDiscount = filtered.reduce((s, r) => s + (r.discount_cop ?? 0), 0);

  // ---- Export helpers ----
  function buildExportData() {
    return filtered.map((r) => ({
      Fecha: format(new Date(r.date), "yyyy-MM-dd HH:mm", { locale: es }),
      Fuente: r.source === "session" ? "Checkout" : "Factura",
      Organización: r.org_name,
      Plan: r.plan,
      "Ciclo (meses)": r.cycle_months ?? "",
      "Monto Bruto (COP)": r.amount_cop ?? 0,
      "Descuento (COP)": r.discount_cop ?? 0,
      "Monto Neto (COP)": r.net_amount_cop ?? 0,
      Moneda: r.currency,
      Estado: statusLabel[r.status] || r.status,
      Pasarela: r.provider,
      "Ref. Pasarela": r.provider_ref || "",
      "Periodo Inicio": r.period_start ? format(new Date(r.period_start), "yyyy-MM-dd") : "",
      "Periodo Fin": r.period_end ? format(new Date(r.period_end), "yyyy-MM-dd") : "",
      ID: r.id,
      "Org ID": r.org_id,
    }));
  }

  function exportCSV() {
    const data = buildExportData();
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = String((row as any)[h] ?? "");
            return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
          })
          .join(",")
      ),
    ];
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `contabilidad_${dateFrom}_${dateTo}.csv`);
  }

  function exportExcel() {
    const data = buildExportData();
    if (!data.length) return;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contabilidad");
    XLSX.writeFile(wb, `contabilidad_${dateFrom}_${dateTo}.xlsx`);
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-amber-400" />
          Contabilidad
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Exporta transacciones y facturas para contabilidad. Filtra por rango de fechas, organización, plan y estado.
        </p>
      </div>

      {/* Filters */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardContent className="pt-4 space-y-4">
          {/* Row 1: dates + source */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> Desde
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40 bg-slate-800/60 border-slate-600"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> Hasta
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40 bg-slate-800/60 border-slate-600"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Fuente
              </label>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceType)}>
                <SelectTrigger className="w-36 bg-slate-800/60 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="sessions">Checkouts</SelectItem>
                  <SelectItem value="invoices">Facturas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Plan</label>
              <Select value={planFilter} onValueChange={setPlanFilter}>
                <SelectTrigger className="w-36 bg-slate-800/60 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {planOptions.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Estado</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 bg-slate-800/60 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>{statusLabel[s] || s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: org search + export buttons */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[200px] max-w-xs">
              <label className="text-xs text-slate-400 flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Organización
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <Input
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  placeholder="Buscar organización…"
                  className="pl-8 bg-slate-800/60 border-slate-600"
                />
              </div>
            </div>
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCSV}
                disabled={filtered.length === 0}
                className="border-slate-600 text-slate-300 hover:text-slate-100"
              >
                <Download className="h-4 w-4 mr-1.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportExcel}
                disabled={filtered.length === 0}
                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-slate-400">
          {filtered.length} registro(s)
        </span>
        <span className="text-slate-300 font-medium">
          Total neto: {formatCOP(totalAmount)}
        </span>
        {totalDiscount > 0 && (
          <span className="text-purple-400">
            Descuentos: {formatCOP(totalDiscount)}
          </span>
        )}
      </div>

      {/* Data table */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardContent className="pt-2 px-0">
          {isLoading ? (
            <p className="text-sm text-slate-400 px-4 py-6">Cargando registros…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500 px-4 py-6">No hay registros para los filtros seleccionados.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50 hover:bg-transparent">
                    <TableHead className="text-slate-400">Fecha</TableHead>
                    <TableHead className="text-slate-400">Fuente</TableHead>
                    <TableHead className="text-slate-400">Organización</TableHead>
                    <TableHead className="text-slate-400">Plan</TableHead>
                    <TableHead className="text-slate-400">Ciclo</TableHead>
                    <TableHead className="text-slate-400 text-right">Bruto</TableHead>
                    <TableHead className="text-slate-400 text-right">Desc.</TableHead>
                    <TableHead className="text-slate-400 text-right">Neto</TableHead>
                    <TableHead className="text-slate-400">Estado</TableHead>
                    <TableHead className="text-slate-400">Pasarela</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="border-slate-800/50 hover:bg-slate-800/30">
                      <TableCell className="text-slate-300 whitespace-nowrap">
                        {format(new Date(r.date), "dd MMM yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                          {r.source === "session" ? "Checkout" : "Factura"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-200 max-w-[180px] truncate" title={r.org_name}>
                        {r.org_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.plan}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-center">
                        {r.cycle_months ? `${r.cycle_months}m` : "—"}
                      </TableCell>
                      <TableCell className="text-slate-300 text-right font-mono text-xs">
                        {formatCOP(r.amount_cop)}
                      </TableCell>
                      <TableCell className="text-purple-400 text-right font-mono text-xs">
                        {r.discount_cop ? formatCOP(r.discount_cop) : "—"}
                      </TableCell>
                      <TableCell className="text-slate-100 text-right font-mono text-xs font-medium">
                        {formatCOP(r.net_amount_cop)}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusStyle[r.status] || "bg-slate-500/20 text-slate-300"}>
                          {statusLabel[r.status] || r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">{r.provider}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
