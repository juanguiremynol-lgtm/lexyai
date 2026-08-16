/**
 * "Calidad en que actúa su cliente" — ITER56 one-time onboarding.
 *
 * A migration surface, not a permanent screen: it clears the portfolio in one
 * sitting and retires itself when nothing is left unconfirmed. Attention is
 * routed by how sure the machine is — bulk where a match is verbatim,
 * deliberation where it is partial, a specific remedy where there is no
 * proposal at all — and every row states the CONSEQUENCE before confirming.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, ShieldQuestion, ShieldAlert, UserPlus, ScanSearch } from "lucide-react";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import {
  usePartyCapacityRows,
  useConfirmCapacity,
  type CapacityRow,
  type ConfirmInput,
  type ConfirmResult,
} from "@/hooks/use-party-capacity";
import {
  CLIENT_PARTY_ROLES,
  CLIENT_PARTY_ROLE_LABELS,
  type ClientPartyRole,
  type RepresentedParty,
} from "@/lib/workflow-terms/party-attribution";
import {
  computeAttributionConsequence,
  consequenceCopy,
  NO_PROPOSAL_COPY,
} from "@/lib/workflow-terms/party-capacity";

export default function PartyRolesReview() {
  const { isPlatformAdmin, isLoading: adminLoading } = usePlatformAdmin();
  const { data: rows = [], isLoading } = usePartyCapacityRows();
  const confirm = useConfirmCapacity();
  const [overrides, setOverrides] = useState<Record<string, ClientPartyRole>>({});
  const [represents, setRepresents] = useState<Record<string, RepresentedParty>>({});
  const [summary, setSummary] = useState<ConfirmResult | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState(0);

  const high = useMemo(() => rows.filter((r) => r.section === "ALTA_CONFIANZA"), [rows]);
  const review = useMemo(() => rows.filter((r) => r.section === "REVISION"), [rows]);
  // ITER58 — a matter with no client attached cannot be attributed at all, so
  // it leads the list: associating the client is what unblocks every later step.
  const none = useMemo(
    () =>
      rows
        .filter((r) => r.section === "SIN_PROPUESTA")
        .sort((a, b) =>
          Number(b.reason === "SIN_CLIENTE") - Number(a.reason === "SIN_CLIENTE"),
        ),
    [rows],
  );
  const sinCliente = useMemo(() => none.filter((r) => r.reason === "SIN_CLIENTE"), [none]);

  // A curador ad litem borrows the side of the party he was appointed for, so
  // the offer is APODERADO_DE_OFICIO — never a collapse onto DEMANDADO.
  const roleOf = (r: CapacityRow): ClientPartyRole | null =>
    overrides[r.id] ?? r.role ?? (r.reason === "CURADOR_AD_LITEM" ? "APODERADO_DE_OFICIO" : null);
  const repOf = (r: CapacityRow): RepresentedParty | null =>
    represents[r.id] ?? r.represents ?? null;

  const runConfirm = (items: CapacityRow[]) => {
    const payload: ConfirmInput[] = [];
    for (const r of items) {
      const role = roleOf(r);
      if (!role) continue;
      if (role === "APODERADO_DE_OFICIO" && !repOf(r)) {
        toast.error("Indique a quién representa el curador ad litem", {
          id: "capacity-rep",
          duration: 4000,
        });
        return;
      }
      payload.push({ row: r, role, represents: repOf(r) });
    }
    if (payload.length === 0) return;
    confirm.mutate(payload, {
      onSuccess: (res) => {
        setConfirmedTotal((n) => n + res.confirmed);
        setSummary((s) => ({
          confirmed: (s?.confirmed ?? 0) + res.confirmed,
          deadlinesChanged: (s?.deadlinesChanged ?? 0) + res.deadlinesChanged,
          alertsRetired: (s?.alertsRetired ?? 0) + res.alertsRetired,
        }));
        toast.success(`${res.confirmed} expediente(s) confirmados`, {
          id: "capacity-confirm",
          duration: 3000,
        });
      },
      onError: (e: unknown) =>
        toast.error(e instanceof Error ? e.message : "No fue posible confirmar", {
          id: "capacity-confirm",
          duration: 5000,
        }),
    });
  };

  const RoleSelect = ({ r }: { r: CapacityRow }) => (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={roleOf(r) ?? undefined}
        onValueChange={(v) => setOverrides((o) => ({ ...o, [r.id]: v as ClientPartyRole }))}
      >
        <SelectTrigger className="h-8 w-[230px]">
          <SelectValue placeholder="Seleccione la calidad" />
        </SelectTrigger>
        <SelectContent>
          {CLIENT_PARTY_ROLES.map((cr) => (
            <SelectItem key={cr} value={cr}>
              {CLIENT_PARTY_ROLE_LABELS[cr]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {roleOf(r) === "APODERADO_DE_OFICIO" && (
        <Select
          value={repOf(r) ?? undefined}
          onValueChange={(v) => setRepresents((s) => ({ ...s, [r.id]: v as RepresentedParty }))}
        >
          <SelectTrigger className="h-8 w-[210px]">
            <SelectValue placeholder="¿A quién representa?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DEMANDANTE">Representa al demandante</SelectItem>
            <SelectItem value="DEMANDADO">Representa al demandado</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );

  const Consequence = ({ r }: { r: CapacityRow }) => (
    <p className="text-xs text-muted-foreground">
      {consequenceCopy(computeAttributionConsequence(r.deadlines, roleOf(r), repOf(r)))}
    </p>
  );

  if (!adminLoading && !isPlatformAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Esta pantalla está reservada a los administradores de la plataforma.
          </CardContent>
        </Card>
      </div>
    );
  }

  const pending = rows.length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Calidad en que actúa su cliente</h1>
          <p className="text-sm text-muted-foreground">
            Confirmación única de toda la cartera. De la calidad depende a quién corresponde cada
            término: mientras no esté confirmada, los términos de la contraparte no se filtran.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {confirmedTotal} confirmados · {pending} pendientes
        </Badge>
      </div>

      {summary && (
        <Card className="border-emerald-500/40">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-medium">Resultado de esta sesión</p>
            <p className="text-muted-foreground">
              {summary.confirmed} expediente(s) confirmados · {summary.deadlinesChanged} término(s)
              cambiaron de atribución · {summary.alertsRetired} alerta(s) dejaron de ser aplicables.
            </p>
            {pending === 0 && (
              <p className="text-muted-foreground">
                No queda ningún expediente por confirmar: esta pantalla se retira.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && pending === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Todas las calidades están confirmadas. Si más adelante ingresa un expediente sin
            confirmar, volverá a aparecer aquí y en el aviso superior.
          </CardContent>
        </Card>
      )}

      {high.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Alta confianza <Badge variant="secondary">{high.length}</Badge>
            </CardTitle>
            <Button size="sm" disabled={confirm.isPending} onClick={() => runConfirm(high)}>
              Confirmar las {high.length}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Coincidencia literal del nombre del cliente con una de las partes. Puede corregir
              cualquier fila antes de confirmar en bloque.
            </p>
            {high.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <Link
                    to={`/app/items/${r.id}`}
                    className="font-mono text-sm font-medium hover:underline"
                  >
                    {r.radicado ?? "Sin radicado"}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.clientName ?? "Sin cliente"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Coincide con: <span className="font-medium">{r.basis ?? "—"}</span>
                  </p>
                  <Consequence r={r} />
                </div>
                <RoleSelect r={r} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {review.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanSearch className="h-4 w-4" aria-hidden />
              Revisión <Badge variant="secondary">{review.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Coincidencia parcial: confirme una por una tras leer ambas partes.
            </p>
            {review.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/app/items/${r.id}`} className="font-mono text-sm font-medium hover:underline">
                    {r.radicado ?? "Sin radicado"}
                  </Link>
                  <Badge variant="outline">confianza {(r.confidence * 100).toFixed(0)}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cliente: <span className="font-medium">{r.clientName ?? "Sin cliente"}</span>
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded bg-muted/50 p-2 text-xs">
                    <p className="font-medium">Demandantes</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {r.demandantes?.trim() || "(vacío)"}
                    </p>
                  </div>
                  <div className="rounded bg-muted/50 p-2 text-xs">
                    <p className="font-medium">Demandados</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {r.demandados?.trim() || "(vacío)"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{r.basis ?? "—"}</p>
                <Consequence r={r} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <RoleSelect r={r} />
                  <Button size="sm" disabled={confirm.isPending} onClick={() => runConfirm([r])}>
                    Confirmar
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {none.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldQuestion className="h-4 w-4" aria-hidden />
              Sin propuesta <Badge variant="secondary">{none.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sinCliente.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {sinCliente.length} expediente(s) no tienen cliente vinculado: sin cliente no hay
                calidad que confirmar ni términos que atribuir. Aparecen de primeros.
              </p>
            )}
            {none.map((r) => {
              const copy = NO_PROPOSAL_COPY[r.reason ?? "SIN_COINCIDENCIA"];
              return (
                <div key={r.id} className="space-y-2 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/app/items/${r.id}`} className="font-mono text-sm font-medium hover:underline">
                      {r.radicado ?? "Sin radicado"}
                    </Link>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" aria-hidden />
                      {copy.title}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{copy.remedy}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded bg-muted/50 p-2 text-xs">
                      <p className="font-medium">Demandantes</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {r.demandantes?.trim() || "(vacío)"}
                      </p>
                    </div>
                    <div className="rounded bg-muted/50 p-2 text-xs">
                      <p className="font-medium">Demandados</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">
                        {r.demandados?.trim() || "(vacío)"}
                      </p>
                    </div>
                  </div>
                  <Consequence r={r} />
                  {r.reason === "SIN_CLIENTE" ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/app/items/${r.id}`}>
                        <UserPlus className="mr-1 h-4 w-4" aria-hidden />
                        Asociar cliente
                      </Link>
                    </Button>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <RoleSelect r={r} />
                      <Button
                        size="sm"
                        disabled={confirm.isPending || !roleOf(r)}
                        onClick={() => runConfirm([r])}
                      >
                        Confirmar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
