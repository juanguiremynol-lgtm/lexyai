/**
 * HonorariosSection — Full honorarios configuration for contract wizard
 * Supports: Fijos, Cuota Litis, Mixtos, Mensualidad, Personalizado
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  DollarSign, BarChart3, Plus, Trash2, AlertCircle, CheckCircle2, Calendar, Pencil,
} from "lucide-react";
import type {
  HonorariosType, HonorariosData, FixedComponent, CuotaLitis, MonthlyFee, Installment,
} from "@/lib/honorarios-utils";
import {
  INSTALLMENT_PRESETS, MILESTONE_OPTIONS, CUOTA_LITIS_BASES, CUOTA_LITIS_TRIGGERS,
  numberToSpanishWords, formatCOP, getCurrentSMLMV,
} from "@/lib/honorarios-utils";

// ─── Type Selector ───────────────────────────────────────

function HonorariosTypeSelector({
  value,
  onChange,
}: {
  value: HonorariosType;
  onChange: (t: HonorariosType) => void;
}) {
  const options: { type: HonorariosType; icon: React.ReactNode; title: string; desc: string }[] = [
    { type: "fijos", icon: <DollarSign className="h-5 w-5" />, title: "Fijos", desc: "Valor fijo por el servicio" },
    { type: "cuota_litis", icon: <BarChart3 className="h-5 w-5" />, title: "Cuota litis", desc: "% del resultado favorable" },
    { type: "mixtos", icon: <><DollarSign className="h-4 w-4" /><BarChart3 className="h-4 w-4" /></>, title: "Mixtos", desc: "Valor fijo + % del resultado" },
    { type: "mensualidad", icon: <Calendar className="h-5 w-5" />, title: "Mensualidad", desc: "Pago mensual recurrente" },
    { type: "personalizado", icon: <Pencil className="h-5 w-5" />, title: "Personalizado", desc: "Defina su propia estructura" },
  ];

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Tipo de honorarios</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {options.map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => onChange(o.type)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
              value === o.type
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border hover:border-primary/40 hover:bg-muted/30"
            }`}
          >
            <span className={`flex items-center gap-0.5 ${value === o.type ? "text-primary" : "text-muted-foreground"}`}>{o.icon}</span>
            <span className="font-medium text-xs">{o.title}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">{o.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Fixed Fee Section ───────────────────────────────────

function FixedFeeSection({
  data,
  onChange,
  smlmv,
}: {
  data: FixedComponent;
  onChange: (d: FixedComponent) => void;
  smlmv: number;
}) {
  const [useSMLMV, setUseSMLMV] = useState(!!data.amount_smlmv);
  const [presetIdx, setPresetIdx] = useState<string>("custom");

  const updateAmount = useCallback((amount: number) => {
    const words = amount > 0 ? numberToSpanishWords(amount) : '';
    const newInstallments = data.installments.map(inst => ({
      ...inst,
      amount: Math.round(amount * inst.percentage / 100),
    }));
    onChange({ ...data, amount, amount_words: words, installments: newInstallments });
  }, [data, onChange]);

  const updateSMLMV = useCallback((smlmvCount: number) => {
    const amount = Math.round(smlmvCount * smlmv);
    const words = amount > 0 ? numberToSpanishWords(amount) : '';
    const newInstallments = data.installments.map(inst => ({
      ...inst,
      amount: Math.round(amount * inst.percentage / 100),
    }));
    onChange({ ...data, amount, amount_smlmv: smlmvCount, amount_words: words, installments: newInstallments });
  }, [data, onChange, smlmv]);

  const applyPreset = (idx: string) => {
    setPresetIdx(idx);
    if (idx === "custom") return;
    const preset = INSTALLMENT_PRESETS[Number(idx)];
    if (!preset) return;
    const installments = preset.installments.map(p => ({
      ...p,
      amount: Math.round(data.amount * p.percentage / 100),
    }));
    onChange({ ...data, installments });
  };

  const updateInstallment = (i: number, field: keyof Installment, val: string | number) => {
    const updated = [...data.installments];
    updated[i] = { ...updated[i], [field]: val };
    // Recalculate amount from percentage
    if (field === 'percentage') {
      updated[i].amount = Math.round(data.amount * Number(val) / 100);
    }
    onChange({ ...data, installments: updated });
  };

  const addInstallment = () => {
    setPresetIdx("custom");
    onChange({ ...data, installments: [...data.installments, { percentage: 0, amount: 0, milestone: '' }] });
  };

  const removeInstallment = (i: number) => {
    if (data.installments.length <= 1) return;
    setPresetIdx("custom");
    onChange({ ...data, installments: data.installments.filter((_, idx) => idx !== i) });
  };

  const totalPct = data.installments.reduce((s, inst) => s + inst.percentage, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Valor total de honorarios</Label>
        <div className="flex items-center gap-3">
          <RadioGroup
            value={useSMLMV ? "smlmv" : "cop"}
            onValueChange={(v) => setUseSMLMV(v === "smlmv")}
            className="flex gap-4"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="cop" id="cop" />
              <Label htmlFor="cop" className="text-xs cursor-pointer">Pesos colombianos</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="smlmv" id="smlmv" />
              <Label htmlFor="smlmv" className="text-xs cursor-pointer">Salarios mínimos (SMLMV)</Label>
            </div>
          </RadioGroup>
        </div>

        {useSMLMV ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">SMLMV</Label>
              <Input
                type="number"
                min={0}
                value={data.amount_smlmv || ''}
                onChange={(e) => updateSMLMV(Number(e.target.value) || 0)}
                placeholder="5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Equivalente COP</Label>
              <Input value={data.amount > 0 ? `$${formatCOP(data.amount)}` : ''} disabled className="bg-muted" />
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              type="number"
              min={0}
              value={data.amount || ''}
              onChange={(e) => updateAmount(Number(e.target.value) || 0)}
              placeholder="15000000"
            />
          </div>
        )}

        {data.amount > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-1.5">
            En letras: <strong>{data.amount_words}</strong>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Forma de pago</Label>
          <Select value={presetIdx} onValueChange={applyPreset}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {INSTALLMENT_PRESETS.map((p, i) => (
                <SelectItem key={i} value={String(i)} className="text-xs">{p.label}</SelectItem>
              ))}
              <SelectItem value="custom" className="text-xs">Personalizar cuotas...</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {data.installments.map((inst, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-16">
              <Input
                type="number"
                min={0}
                max={100}
                value={inst.percentage || ''}
                onChange={(e) => updateInstallment(i, 'percentage', Number(e.target.value))}
                className="h-8 text-xs text-center"
              />
            </div>
            <span className="text-xs text-muted-foreground">%</span>
            <div className="w-24 text-xs text-muted-foreground">
              ${formatCOP(inst.amount)}
            </div>
            <Select
              value={MILESTONE_OPTIONS.includes(inst.milestone) ? inst.milestone : '_custom'}
              onValueChange={(v) => {
                if (v === '_custom') {
                  updateInstallment(i, 'milestone', '');
                } else {
                  updateInstallment(i, 'milestone', v);
                }
              }}
            >
              <SelectTrigger className="flex-1 h-8 text-xs">
                <SelectValue placeholder="Hito de pago..." />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                ))}
                <SelectItem value="_custom" className="text-xs">Personalizado...</SelectItem>
              </SelectContent>
            </Select>
            {!MILESTONE_OPTIONS.includes(inst.milestone) && inst.milestone !== undefined && (
              <Input
                value={inst.milestone}
                onChange={(e) => updateInstallment(i, 'milestone', e.target.value)}
                className="flex-1 h-8 text-xs"
                placeholder="Describa el hito..."
              />
            )}
            {data.installments.length > 1 && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeInstallment(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addInstallment} className="text-xs h-7">
            <Plus className="h-3 w-3 mr-1" /> Agregar cuota
          </Button>
          <div className={`text-xs flex items-center gap-1 ${totalPct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {totalPct === 100 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            Total: {totalPct}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cuota Litis Section ─────────────────────────────────

function CuotaLitisSection({
  data,
  onChange,
}: {
  data: CuotaLitis;
  onChange: (d: CuotaLitis) => void;
}) {
  const [customBasis, setCustomBasis] = useState(!CUOTA_LITIS_BASES.some(b => b.value === data.basis));
  const [customTrigger, setCustomTrigger] = useState(!CUOTA_LITIS_TRIGGERS.includes(data.payment_trigger));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm">Porcentaje de cuota litis</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            value={data.percentage || ''}
            onChange={(e) => onChange({ ...data, percentage: Number(e.target.value) || 0 })}
            className="w-20"
            placeholder="20"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">¿Sobre qué se calcula?</Label>
        <RadioGroup
          value={customBasis ? '_custom' : data.basis}
          onValueChange={(v) => {
            if (v === '_custom') {
              setCustomBasis(true);
              onChange({ ...data, basis: '' });
            } else {
              setCustomBasis(false);
              onChange({ ...data, basis: v });
            }
          }}
        >
          {CUOTA_LITIS_BASES.map((b) => (
            <div key={b.value} className="flex items-center gap-2">
              <RadioGroupItem value={b.value} id={`basis-${b.value}`} />
              <Label htmlFor={`basis-${b.value}`} className="text-xs cursor-pointer">{b.label}</Label>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <RadioGroupItem value="_custom" id="basis-custom" />
            <Label htmlFor="basis-custom" className="text-xs cursor-pointer">Personalizado</Label>
          </div>
        </RadioGroup>

        {customBasis && (
          <Textarea
            value={data.basis}
            onChange={(e) => onChange({ ...data, basis: e.target.value })}
            rows={3}
            placeholder="Ej: 20% del valor total de la indemnización que se logre obtener..."
            className="text-xs"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Cuándo se paga</Label>
        <RadioGroup
          value={customTrigger ? '_custom' : data.payment_trigger}
          onValueChange={(v) => {
            if (v === '_custom') {
              setCustomTrigger(true);
              onChange({ ...data, payment_trigger: '' });
            } else {
              setCustomTrigger(false);
              onChange({ ...data, payment_trigger: v });
            }
          }}
        >
          {CUOTA_LITIS_TRIGGERS.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <RadioGroupItem value={t} id={`trigger-${t}`} />
              <Label htmlFor={`trigger-${t}`} className="text-xs cursor-pointer">{t}</Label>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <RadioGroupItem value="_custom" id="trigger-custom" />
            <Label htmlFor="trigger-custom" className="text-xs cursor-pointer">Personalizado</Label>
          </div>
        </RadioGroup>

        {customTrigger && (
          <Input
            value={data.payment_trigger}
            onChange={(e) => onChange({ ...data, payment_trigger: e.target.value })}
            placeholder="Describa cuándo se paga..."
            className="text-xs"
          />
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>La cuota litis solo se causa si hay resultado favorable. Si el resultado no es favorable, el cliente no deberá pagar cuota litis.</span>
      </div>
    </div>
  );
}

// ─── Monthly Fee Section ─────────────────────────────────

function MonthlyFeeSection({
  data,
  onChange,
  smlmv,
}: {
  data: MonthlyFee;
  onChange: (d: MonthlyFee) => void;
  smlmv: number;
}) {
  const [useSMLMV, setUseSMLMV] = useState(!!data.amount_smlmv);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Valor mensual</Label>
        <div className="flex items-center gap-3">
          <RadioGroup value={useSMLMV ? "smlmv" : "cop"} onValueChange={(v) => setUseSMLMV(v === "smlmv")} className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="cop" id="monthly-cop" />
              <Label htmlFor="monthly-cop" className="text-xs cursor-pointer">COP</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="smlmv" id="monthly-smlmv" />
              <Label htmlFor="monthly-smlmv" className="text-xs cursor-pointer">SMLMV</Label>
            </div>
          </RadioGroup>
        </div>

        {useSMLMV ? (
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} value={data.amount_smlmv || ''} onChange={(e) => {
              const count = Number(e.target.value) || 0;
              onChange({ ...data, amount_smlmv: count, amount: Math.round(count * smlmv) });
            }} placeholder="2" />
            <Input value={data.amount > 0 ? `$${formatCOP(data.amount)}` : ''} disabled className="bg-muted text-xs" />
          </div>
        ) : (
          <Input type="number" min={0} value={data.amount || ''} onChange={(e) => onChange({ ...data, amount: Number(e.target.value) || 0, amount_smlmv: null })} placeholder="3000000" />
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Duración</Label>
        <RadioGroup value={data.duration} onValueChange={(v) => onChange({ ...data, duration: v, duration_months: v === 'plazo_fijo' ? 12 : null })}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="indefinida" id="dur-indef" />
            <Label htmlFor="dur-indef" className="text-xs cursor-pointer">Indefinida (hasta terminación del proceso)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="plazo_fijo" id="dur-fijo" />
            <Label htmlFor="dur-fijo" className="text-xs cursor-pointer">Plazo fijo</Label>
          </div>
        </RadioGroup>

        {data.duration === 'plazo_fijo' && (
          <div className="flex items-center gap-2">
            <Input type="number" min={1} value={data.duration_months || ''} onChange={(e) => onChange({ ...data, duration_months: Number(e.target.value) || 0 })} className="w-20" />
            <span className="text-xs text-muted-foreground">meses</span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-sm">Día de pago mensual</Label>
        <div className="flex items-center gap-2">
          <Input type="number" min={1} max={30} value={data.payment_day || ''} onChange={(e) => onChange({ ...data, payment_day: Number(e.target.value) || 5 })} className="w-20" />
          <span className="text-xs text-muted-foreground">de cada mes</span>
        </div>
      </div>
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────

function HonorariosSummary({ data }: { data: HonorariosData }) {
  if (data.honorarios_type === 'personalizado') {
    return (
      <div className="bg-muted/30 rounded-lg p-3 text-xs">
        <strong>Tipo:</strong> Personalizado (cláusula libre)
      </div>
    );
  }

  return (
    <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-xs">
      <div className="font-medium text-sm mb-1">Resumen de honorarios</div>
      {data.fixed_component && (data.honorarios_type === 'fijos' || data.honorarios_type === 'mixtos') && (
        <div>
          <strong>Componente fijo:</strong> ${formatCOP(data.fixed_component.amount)}
          {data.fixed_component.amount_smlmv ? ` (${data.fixed_component.amount_smlmv} SMLMV)` : ''}
          {data.fixed_component.installments.length > 0 && (
            <ul className="ml-4 mt-0.5 space-y-0.5 list-disc list-inside">
              {data.fixed_component.installments.map((inst, i) => (
                <li key={i}>{inst.percentage}% (${formatCOP(inst.amount)}) — {inst.milestone}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {data.cuota_litis && (data.honorarios_type === 'cuota_litis' || data.honorarios_type === 'mixtos') && (
        <div>
          <strong>Cuota litis:</strong> {data.cuota_litis.percentage}% {data.cuota_litis.basis ? `— ${data.cuota_litis.basis}` : ''}
          {data.cuota_litis.payment_trigger && <span className="text-muted-foreground"> · {data.cuota_litis.payment_trigger}</span>}
        </div>
      )}
      {data.monthly_fee && data.honorarios_type === 'mensualidad' && (
        <div>
          <strong>Mensualidad:</strong> ${formatCOP(data.monthly_fee.amount)}
          {data.monthly_fee.amount_smlmv ? ` (${data.monthly_fee.amount_smlmv} SMLMV)` : ''}
          {' · Día '}{data.monthly_fee.payment_day}
          {' · '}{data.monthly_fee.duration === 'indefinida' ? 'Indefinida' : `${data.monthly_fee.duration_months} meses`}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export interface HonorariosSectionProps {
  data: HonorariosData;
  onChange: (data: HonorariosData) => void;
}

export function HonorariosSection({ data, onChange }: HonorariosSectionProps) {
  const [smlmv, setSmlmv] = useState(1423500);

  useEffect(() => {
    getCurrentSMLMV().then(setSmlmv);
  }, []);

  const handleTypeChange = (type: HonorariosType) => {
    const updated: HonorariosData = {
      ...data,
      honorarios_type: type,
    };

    // Initialize sub-components as needed
    if ((type === 'fijos' || type === 'mixtos') && !updated.fixed_component) {
      updated.fixed_component = {
        amount: 0, amount_smlmv: null, amount_words: '', currency: 'COP',
        installments: [
          { percentage: 50, amount: 0, milestone: 'Al firmar el contrato' },
          { percentage: 50, amount: 0, milestone: 'Al presentar la demanda' },
        ],
      };
    }
    if ((type === 'cuota_litis' || type === 'mixtos') && !updated.cuota_litis) {
      updated.cuota_litis = { percentage: 20, basis: CUOTA_LITIS_BASES[0].value, payment_trigger: CUOTA_LITIS_TRIGGERS[0] };
    }
    if (type === 'mensualidad' && !updated.monthly_fee) {
      updated.monthly_fee = { amount: 0, amount_smlmv: null, payment_day: 5, duration: 'indefinida', duration_months: null };
    }

    onChange(updated);
  };

  const showCuotaLitisForMonthly = data.honorarios_type === 'mensualidad';

  return (
    <div className="space-y-4">
      <HonorariosTypeSelector value={data.honorarios_type} onChange={handleTypeChange} />

      <Separator />

      {/* Fixed fee */}
      {(data.honorarios_type === 'fijos' || data.honorarios_type === 'mixtos') && data.fixed_component && (
        <>
          {data.honorarios_type === 'mixtos' && (
            <Label className="text-sm font-medium">Componente Fijo</Label>
          )}
          <FixedFeeSection
            data={data.fixed_component}
            onChange={(fc) => onChange({ ...data, fixed_component: fc })}
            smlmv={smlmv}
          />
          {data.honorarios_type === 'mixtos' && <Separator />}
        </>
      )}

      {/* Cuota litis */}
      {(data.honorarios_type === 'cuota_litis' || data.honorarios_type === 'mixtos') && data.cuota_litis && (
        <>
          {data.honorarios_type === 'mixtos' && (
            <Label className="text-sm font-medium">Componente Cuota Litis</Label>
          )}
          <CuotaLitisSection
            data={data.cuota_litis}
            onChange={(cl) => onChange({ ...data, cuota_litis: cl })}
          />
        </>
      )}

      {/* Monthly */}
      {data.honorarios_type === 'mensualidad' && data.monthly_fee && (
        <>
          <MonthlyFeeSection
            data={data.monthly_fee}
            onChange={(mf) => onChange({ ...data, monthly_fee: mf })}
            smlmv={smlmv}
          />
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm">¿Incluye cuota litis adicional?</Label>
            <RadioGroup
              value={data.cuota_litis ? 'yes' : 'no'}
              onValueChange={(v) => {
                if (v === 'yes') {
                  onChange({ ...data, cuota_litis: { percentage: 20, basis: CUOTA_LITIS_BASES[0].value, payment_trigger: CUOTA_LITIS_TRIGGERS[0] } });
                } else {
                  onChange({ ...data, cuota_litis: null });
                }
              }}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="no" id="cl-no" />
                <Label htmlFor="cl-no" className="text-xs cursor-pointer">No</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="yes" id="cl-yes" />
                <Label htmlFor="cl-yes" className="text-xs cursor-pointer">Sí</Label>
              </div>
            </RadioGroup>
          </div>
          {data.cuota_litis && (
            <CuotaLitisSection
              data={data.cuota_litis}
              onChange={(cl) => onChange({ ...data, cuota_litis: cl })}
            />
          )}
        </>
      )}

      {/* Custom */}
      {data.honorarios_type === 'personalizado' && (
        <div className="space-y-2">
          <Label className="text-sm">Describa la estructura de honorarios</Label>
          <Textarea
            value={data.custom_text_html || ''}
            onChange={(e) => onChange({ ...data, custom_text_html: e.target.value })}
            rows={8}
            placeholder="Escriba libremente la cláusula de honorarios. Este texto reemplazará completamente la cláusula de honorarios en el contrato."
          />
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Este texto se incluirá directamente en la cláusula de honorarios del contrato.</span>
          </div>
        </div>
      )}

      {/* Summary */}
      {data.honorarios_type !== 'personalizado' && (data.fixed_component?.amount || data.cuota_litis?.percentage || data.monthly_fee?.amount) ? (
        <>
          <Separator />
          <HonorariosSummary data={data} />
        </>
      ) : null}
    </div>
  );
}
