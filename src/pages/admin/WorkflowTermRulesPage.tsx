/**
 * "Reglas de términos penales" — admin screen (iteration 31).
 *
 * Lists the DRAFT penal (Ley 906) rules with their statutory citation, anchor
 * and day count, lets the lawyer correct them, and ratifies them one by one.
 * A DRAFT rule computes nothing.
 */
import { useState } from "react";
import { Loader2, Gavel, CheckCircle2, Pencil, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PENAL_ANCHOR_LABELS,
  usePenalDeadlineRules,
  usePenalDeadlineRuleActions,
  type PenalAnchorType,
  type PenalDeadlineRule,
} from "@/hooks/use-workflow-deadline-rules";

function RuleEditor({ rule, onClose }: { rule: PenalDeadlineRule; onClose: () => void }) {
  const { update } = usePenalDeadlineRuleActions();
  const [label, setLabel] = useState(rule.label);
  const [citation, setCitation] = useState(rule.citation ?? "");
  const [anchorType, setAnchorType] = useState<PenalAnchorType>(rule.anchor_type);
  const [anchorEvent, setAnchorEvent] = useState(rule.anchor_event ?? "");
  const [days, setDays] = useState(String(rule.days_amount));
  const [dayType, setDayType] = useState(rule.day_type);
  const [description, setDescription] = useState(rule.description ?? "");

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`label-${rule.id}`}>Nombre del término</Label>
          <Input id={`label-${rule.id}`} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`cite-${rule.id}`}>Cita normativa</Label>
          <Input id={`cite-${rule.id}`} value={citation} onChange={(e) => setCitation(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Ancla</Label>
          <Select value={anchorType} onValueChange={(v) => setAnchorType(v as PenalAnchorType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PENAL_ANCHOR_LABELS) as PenalAnchorType[]).map((k) => (
                <SelectItem key={k} value={k}>{PENAL_ANCHOR_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`ev-${rule.id}`}>Evento ancla</Label>
          <Input id={`ev-${rule.id}`} value={anchorEvent} onChange={(e) => setAnchorEvent(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`days-${rule.id}`}>Días</Label>
          <Input
            id={`days-${rule.id}`}
            type="number"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Tipo de días</Label>
          <Select value={dayType} onValueChange={(v) => setDayType(v as "BUSINESS" | "CALENDAR")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="BUSINESS">Hábiles</SelectItem>
              <SelectItem value="CALENDAR">Calendario</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`desc-${rule.id}`}>Descripción</Label>
        <Textarea id={`desc-${rule.id}`} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                id: rule.id,
                patch: {
                  label,
                  citation: citation || null,
                  anchor_type: anchorType,
                  anchor_event: anchorEvent || null,
                  days_amount: Number(days) || 0,
                  day_type: dayType,
                  description: description || null,
                },
              },
              {
                onSuccess: () => {
                  toast.success("Regla actualizada");
                  onClose();
                },
                onError: (e) => toast.error((e as Error).message),
              },
            )}
        >
          Guardar
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
      </div>
    </div>
  );
}

export default function PenalTermRulesPage() {
  const { data: rules = [], isLoading, error } = usePenalDeadlineRules();
  const { ratify, unratify } = usePenalDeadlineRuleActions();
  const [editing, setEditing] = useState<string | null>(null);

  const drafts = rules.filter((r) => r.status === "DRAFT");
  const ratified = rules.filter((r) => r.status === "RATIFIED");

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Gavel className="h-5 w-5" aria-hidden />
          Reglas de términos penales (Ley 906)
        </h1>
        <p className="text-sm text-muted-foreground">
          Los términos penales se anclan en fechas de audiencia y actos procesales, no en la
          fijación en estado. Una regla en borrador no calcula ningún término: solo se aplica
          después de ratificarla.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando reglas…
        </div>
      )}
      {error && <p className="text-sm text-destructive">Error: {(error as Error).message}</p>}

      {!isLoading && ratified.length === 0 && (
        <Alert>
          <AlertDescription>
            Ninguna regla ha sido ratificada todavía. Los expedientes penales muestran su etapa y
            su línea procesal, pero no calculan términos.
          </AlertDescription>
        </Alert>
      )}

      {[
        { title: `Borradores (${drafts.length})`, items: drafts, draft: true },
        { title: `Ratificadas (${ratified.length})`, items: ratified, draft: false },
      ].map((section) => (
        <section key={section.title} className="space-y-3">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {section.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin reglas en esta categoría.</p>
          )}
          {section.items.map((rule) => (
            <Card key={rule.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {rule.label}
                  <Badge variant={section.draft ? "outline" : "default"}>
                    {section.draft ? "Borrador" : "Ratificada"}
                  </Badge>
                  {rule.citation && (
                    <span className="text-xs font-normal text-muted-foreground">{rule.citation}</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {PENAL_ANCHOR_LABELS[rule.anchor_type]}
                  {rule.anchor_event ? ` · ${rule.anchor_event}` : ""} · {rule.days_amount} días{" "}
                  {rule.day_type === "BUSINESS" ? "hábiles" : "calendario"}
                </p>
                {rule.description && <p className="text-sm">{rule.description}</p>}

                {editing === rule.id ? (
                  <RuleEditor rule={rule} onClose={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(rule.id)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Editar
                    </Button>
                    {section.draft ? (
                      <Button
                        size="sm"
                        disabled={ratify.isPending}
                        onClick={() =>
                          ratify.mutate(rule.id, {
                            onSuccess: () => toast.success("Regla ratificada"),
                            onError: (e) => toast.error((e as Error).message),
                          })}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Ratificar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={unratify.isPending}
                        onClick={() =>
                          unratify.mutate(rule.id, {
                            onSuccess: () => toast.success("Regla devuelta a borrador"),
                            onError: (e) => toast.error((e as Error).message),
                          })}
                      >
                        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Volver a borrador
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}