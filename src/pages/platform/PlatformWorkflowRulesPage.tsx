/**
 * Platform console — the missing-rules register (iteration 50).
 *
 * This register is what stops a modelling gap from reading as "no term exists".
 * Its audience is us, not the litigator: the matter surface only carries a
 * single restrained line saying the workflow has gaps.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMissingRules } from "@/hooks/use-missing-rules";

export default function PlatformWorkflowRulesPage() {
  const [workflow, setWorkflow] = useState<string>("ALL");
  const { data: rules = [], isLoading } = useMissingRules(
    workflow === "ALL" ? undefined : workflow,
  );

  const workflows = useMemo(() => {
    const all = new Set(rules.map((r) => r.workflow_type));
    return Array.from(all).sort();
  }, [rules]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reglas de términos no modeladas</h1>
          <p className="text-sm text-muted-foreground">
            Registro interno de vacíos: términos que la ley contempla y que aún no hemos podido
            verificar contra fuente primaria.
          </p>
        </div>
        <Select value={workflow} onValueChange={setWorkflow}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los flujos</SelectItem>
            {["CGP", "LABORAL", "PENAL_906", "EJECUTIVO", "CPACA", "TUTELA", ...workflows]
              .filter((w, i, a) => a.indexOf(w) === i)
              .map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isLoading ? "Cargando…" : `${rules.length} vacío(s) registrado(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Término</TableHead>
                <TableHead>Flujo</TableHead>
                <TableHead>Régimen</TableHead>
                <TableHead>Norma esperada</TableHead>
                <TableHead>Clase</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.workflow_type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.regimen ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.expected_citation ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[420px] text-xs text-muted-foreground">
                    {r.reason}
                    {r.notes ? ` — ${r.notes}` : ""}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Sin vacíos registrados para este filtro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
