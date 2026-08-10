/**
 * "Calidad de las partes" — bulk confirmation of proposed client roles.
 *
 * Attribution of a term is only as good as the role behind it, and a proposed
 * role is a guess until the litigator owns it. This screen makes owning the
 * whole portfolio a single pass instead of 49 visits to 49 matters.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { CheckCircle2, ShieldQuestion } from "lucide-react";
import {
  CLIENT_PARTY_ROLES,
  CLIENT_PARTY_ROLE_LABELS,
  type ClientPartyRole,
  type RepresentedParty,
} from "@/lib/workflow-terms/party-attribution";

const HIGH_CONFIDENCE = 0.9;

interface ProposalRow {
  id: string;
  radicado: string | null;
  role: ClientPartyRole | null;
  source: string | null;
  confidence: number;
  basis: string | null;
  represents: RepresentedParty | null;
  clientName: string | null;
}

function useRoleProposals() {
  return useQuery({
    queryKey: ["party-role-proposals"],
    staleTime: 30_000,
    queryFn: async (): Promise<ProposalRow[]> => {
      const { data, error } = await supabase
        .from("work_items")
        .select(
          "id, radicado, client_party_role, client_party_role_source, client_party_role_confidence, client_party_role_basis, client_party_represents, clients(name)",
        )
        .eq("lifecycle_state", "ACTIVE")
        .order("radicado", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[])
        .map((r) => ({
          id: String(r.id),
          radicado: (r.radicado as string) ?? null,
          role: (r.client_party_role as ClientPartyRole) ?? null,
          source: (r.client_party_role_source as string) ?? null,
          confidence: Number(r.client_party_role_confidence ?? 0),
          basis: (r.client_party_role_basis as string) ?? null,
          represents: (r.client_party_represents as RepresentedParty) ?? null,
          clientName: ((r.clients as { name?: string } | null)?.name as string) ?? null,
        }))
        .filter((r) => r.source !== "CONFIRMADO");
    },
  });
}

export default function PartyRolesReview() {
  const { data: rows = [], isLoading } = useRoleProposals();
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, ClientPartyRole>>({});
  const [represents, setRepresents] = useState<Record<string, RepresentedParty>>({});

  const confirmRows = useMutation({
    mutationFn: async (items: ProposalRow[]) => {
      const { data: auth } = await supabase.auth.getUser();
      for (const item of items) {
        const role = overrides[item.id] ?? item.role;
        if (!role) continue;
        const rep = represents[item.id] ?? item.represents ?? null;
        const { error } = await supabase
          .from("work_items")
          .update({
            client_party_role: role,
            client_party_role_source: "CONFIRMADO",
            client_party_role_confirmed_at: new Date().toISOString(),
            client_party_role_confirmed_by: auth.user?.id ?? null,
            client_party_represents: role === "APODERADO_DE_OFICIO" ? rep : null,
          } as never)
          .eq("id", item.id);
        if (error) throw error;
      }
      return items.length;
    },
    onSuccess: async (n) => {
      toast.success(`${n} expediente(s) confirmados`, { id: "party-role-confirm", duration: 3000 });
      await queryClient.invalidateQueries({ queryKey: ["party-role-proposals"] });
      await queryClient.invalidateQueries({ queryKey: ["work-item-party-role"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "No fue posible confirmar", {
        id: "party-role-confirm",
        duration: 5000,
      }),
  });

  const highConfidence = useMemo(
    () => rows.filter((r) => r.role && r.confidence >= HIGH_CONFIDENCE),
    [rows],
  );
  const unmatched = useMemo(() => rows.filter((r) => !r.role), [rows]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Calidad en que actúa su cliente</h1>
        <p className="text-sm text-muted-foreground">
          Confirme la calidad de su cliente en cada expediente. De ella depende a quién
          corresponde cada término.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-base">
            Propuestas por confirmar{" "}
            <Badge variant="secondary">{rows.length}</Badge>
          </CardTitle>
          <Button
            size="sm"
            disabled={highConfidence.length === 0 || confirmRows.isPending}
            onClick={() => confirmRows.mutate(highConfidence)}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
            Confirmar todas las de confianza alta ({highConfidence.length})
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <Skeleton className="h-24 w-full" />}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay propuestas pendientes: todas las calidades están confirmadas.
            </p>
          )}
          {rows.map((r) => {
            const role = overrides[r.id] ?? r.role;
            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    to={`/app/item/${r.id}`}
                    className="font-mono text-sm font-medium hover:underline"
                  >
                    {r.radicado ?? "Sin radicado"}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.clientName ?? "Sin cliente asociado"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.basis ? `Coincidencia: ${r.basis}` : "Sin coincidencia con las partes"} ·{" "}
                    confianza {(r.confidence * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={role ?? undefined}
                    onValueChange={(v) =>
                      setOverrides((o) => ({ ...o, [r.id]: v as ClientPartyRole }))
                    }
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
                  {role === "APODERADO_DE_OFICIO" && (
                    <Select
                      value={represents[r.id] ?? r.represents ?? undefined}
                      onValueChange={(v) =>
                        setRepresents((s) => ({ ...s, [r.id]: v as RepresentedParty }))
                      }
                    >
                      <SelectTrigger className="h-8 w-[200px]">
                        <SelectValue placeholder="¿A quién representa?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEMANDANTE">Representa al demandante</SelectItem>
                        <SelectItem value="DEMANDADO">Representa al demandado</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!role || confirmRows.isPending}
                    onClick={() => confirmRows.mutate([r])}
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {unmatched.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldQuestion className="h-4 w-4" aria-hidden />
              Sin propuesta automática ({unmatched.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            El nombre del cliente no coincide con ninguna de las partes registradas. Indique la
            calidad manualmente en la lista anterior.
          </CardContent>
        </Card>
      )}
    </div>
  );
}