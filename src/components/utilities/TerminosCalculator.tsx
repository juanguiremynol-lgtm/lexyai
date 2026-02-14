/**
 * Calculadora de Términos — Wizard UI
 * Steps: 1) Tipo de Término → 2) Fecha de Inicio → 3) Resultado
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Calculator,
  CalendarDays,
  Copy,
  RotateCcw,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  PartyPopper,
  ChevronLeft,
  ChevronRight,
  Check,
  Scale,
  FileText,
  Shield,
  Clock,
  Gavel,
  BookOpen,
} from "lucide-react";
import { format, getYear, differenceInCalendarDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  addBusinessDays,
  getColombianHolidays,
  isBusinessDay,
  isColombianHoliday,
  formatDateCO,
  COMMON_LEGAL_TERMS,
  type LegalTermType,
} from "@/lib/colombian-holidays";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

type WizardStep = "term" | "date" | "result";

const STEPS: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
  { key: "term", label: "Término", icon: <Scale className="h-4 w-4" /> },
  { key: "date", label: "Fecha", icon: <CalendarDays className="h-4 w-4" /> },
  { key: "result", label: "Resultado", icon: <Calculator className="h-4 w-4" /> },
];

// Group terms by category for a cleaner UI
interface TermOption {
  key: LegalTermType | "custom";
  name: string;
  days: number;
  description: string;
  icon: React.ReactNode;
}

const TERM_CATEGORIES: { title: string; items: TermOption[] }[] = [
  {
    title: "Acciones Constitucionales",
    items: [
      { key: "tutela", ...COMMON_LEGAL_TERMS.tutela, icon: <Shield className="h-5 w-5" /> },
      { key: "peticion", ...COMMON_LEGAL_TERMS.peticion, icon: <FileText className="h-5 w-5" /> },
      { key: "peticionInfo", ...COMMON_LEGAL_TERMS.peticionInfo, icon: <FileText className="h-5 w-5" /> },
      { key: "peticionConsulta", ...COMMON_LEGAL_TERMS.peticionConsulta, icon: <BookOpen className="h-5 w-5" /> },
    ],
  },
  {
    title: "Recursos y Procesos",
    items: [
      { key: "recursoReposicion", ...COMMON_LEGAL_TERMS.recursoReposicion, icon: <Gavel className="h-5 w-5" /> },
      { key: "recursoApelacion", ...COMMON_LEGAL_TERMS.recursoApelacion, icon: <Gavel className="h-5 w-5" /> },
      { key: "contestacionDemanda", ...COMMON_LEGAL_TERMS.contestacionDemanda, icon: <Scale className="h-5 w-5" /> },
      { key: "trasladoDemanda", ...COMMON_LEGAL_TERMS.trasladoDemanda, icon: <Scale className="h-5 w-5" /> },
    ],
  },
  {
    title: "Notificaciones y Ejecutoria",
    items: [
      { key: "notificacionPersonal", ...COMMON_LEGAL_TERMS.notificacionPersonal, icon: <Clock className="h-5 w-5" /> },
      { key: "ejecutoriaSentencia", ...COMMON_LEGAL_TERMS.ejecutoriaSentencia, icon: <Clock className="h-5 w-5" /> },
    ],
  },
];

// ============================================
// Component
// ============================================

export function TerminosCalculator() {
  const [step, setStep] = useState<WizardStep>("term");
  const [selectedTerm, setSelectedTerm] = useState<LegalTermType | "custom" | null>(null);
  const [customDays, setCustomDays] = useState<string>("10");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);

  // Holidays for calendar highlighting
  const holidays = useMemo(() => {
    const y = getYear(new Date());
    return [...getColombianHolidays(y), ...getColombianHolidays(y + 1)];
  }, []);

  const days =
    selectedTerm === "custom"
      ? parseInt(customDays) || 0
      : selectedTerm
        ? COMMON_LEGAL_TERMS[selectedTerm].days
        : 0;

  // Result calculation
  const result = useMemo(() => {
    if (!startDate || days <= 0) return null;
    const endDate = addBusinessDays(startDate, days);
    const holidayCheck = isColombianHoliday(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const calendarDaysLeft = differenceInCalendarDays(endDate, today);

    return { startDate, endDate, days, holidayCheck, calendarDaysLeft };
  }, [startDate, days]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  // ---- Actions ----

  const selectTerm = (key: LegalTermType | "custom") => {
    setSelectedTerm(key);
    if (key !== "custom") {
      setStep("date");
    }
  };

  const confirmCustom = () => {
    if (parseInt(customDays) > 0) {
      setStep("date");
    }
  };

  const selectDate = (date: Date | undefined) => {
    setStartDate(date);
    if (date) {
      setStep("result");
    }
  };

  const copyResult = async () => {
    if (!result) return;
    const termName =
      selectedTerm === "custom"
        ? `${days} días hábiles`
        : COMMON_LEGAL_TERMS[selectedTerm!].name;
    const text = `${termName}\nFecha inicio: ${formatDateCO(result.startDate)}\nDías hábiles: ${result.days}\nVencimiento: ${formatDateCO(result.endDate)} (${format(result.endDate, "EEEE", { locale: es })})`;
    await navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  const reset = () => {
    setSelectedTerm(null);
    setStartDate(undefined);
    setCustomDays("10");
    setStep("term");
  };

  // ---- Urgency colors ----

  const getUrgencyInfo = (calDaysLeft: number) => {
    if (calDaysLeft < 0) return { label: "Vencido", color: "bg-destructive/10 text-destructive border-destructive/30", icon: <AlertTriangle className="h-5 w-5" /> };
    if (calDaysLeft === 0) return { label: "Vence HOY", color: "bg-destructive/10 text-destructive border-destructive/30", icon: <AlertTriangle className="h-5 w-5" /> };
    if (calDaysLeft === 1) return { label: "Vence MAÑANA", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300/50", icon: <AlertTriangle className="h-5 w-5" /> };
    if (calDaysLeft <= 3) return { label: `Faltan ${calDaysLeft} días`, color: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200/50", icon: <Clock className="h-5 w-5" /> };
    return { label: `Faltan ${calDaysLeft} días`, color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-200/50", icon: <CheckCircle className="h-5 w-5" /> };
  };

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-4">
      {/* Step Indicator */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
        {STEPS.map((s, i) => {
          const isCurrent = step === s.key;
          const isPast = i < stepIndex;
          const isClickable =
            s.key === "term" ||
            (s.key === "date" && selectedTerm !== null) ||
            (s.key === "result" && selectedTerm !== null && startDate !== undefined);
          return (
            <button
              key={s.key}
              onClick={() => isClickable && setStep(s.key)}
              disabled={!isClickable}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center",
                isCurrent && "bg-background text-foreground shadow-sm",
                isPast && !isCurrent && "text-primary",
                !isCurrent && !isPast && "text-muted-foreground",
                !isClickable && "opacity-50 cursor-not-allowed"
              )}
            >
              {isPast && !isCurrent ? (
                <Check className="h-4 w-4 text-primary" />
              ) : (
                s.icon
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </div>

      <Card>
        {/* ==================== STEP 1: TERM ==================== */}
        {step === "term" && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="h-5 w-5 text-primary" />
                ¿Qué término necesitas calcular?
              </CardTitle>
              <CardDescription>
                Selecciona el tipo de plazo legal o ingresa días personalizados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-5 pr-2">
                  {TERM_CATEGORIES.map((cat) => (
                    <div key={cat.title} className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {cat.title}
                      </h3>
                      <div className="space-y-1">
                        {cat.items.map((item) => (
                          <button
                            key={item.key}
                            onClick={() => selectTerm(item.key as LegalTermType)}
                            className={cn(
                              "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                              "hover:border-primary/50 hover:bg-muted/50",
                              selectedTerm === item.key && "border-primary bg-primary/5"
                            )}
                          >
                            <div className="p-2 rounded-md bg-primary/10 text-primary shrink-0">
                              {item.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{item.description}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0">
                              {item.days}d
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Custom */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Personalizado
                    </h3>
                    <div
                      className={cn(
                        "p-3 rounded-lg border transition-colors",
                        selectedTerm === "custom" && "border-primary bg-primary/5"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-primary/10 text-primary shrink-0">
                          <Calculator className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">Número personalizado de días</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Input
                              type="number"
                              min="1"
                              max="365"
                              value={customDays}
                              onChange={(e) => {
                                setCustomDays(e.target.value);
                                setSelectedTerm("custom");
                              }}
                              onFocus={() => setSelectedTerm("custom")}
                              className="w-24 h-8"
                              placeholder="10"
                            />
                            <span className="text-sm text-muted-foreground">días hábiles</span>
                          </div>
                        </div>
                        {selectedTerm === "custom" && (
                          <Button
                            size="sm"
                            onClick={confirmCustom}
                            disabled={parseInt(customDays) <= 0}
                          >
                            Continuar
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </CardContent>
          </>
        )}

        {/* ==================== STEP 2: DATE ==================== */}
        {step === "date" && selectedTerm && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarDays className="h-5 w-5 text-primary" />
                ¿Desde qué fecha se cuenta?
              </CardTitle>
              <CardDescription>
                Selecciona la fecha de notificación, radicación o desfijación.
                El conteo inicia desde el día siguiente hábil.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Selected term summary */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <Badge variant="secondary">
                  {selectedTerm === "custom"
                    ? `${days} días hábiles`
                    : COMMON_LEGAL_TERMS[selectedTerm].name}
                </Badge>
                <Badge variant="outline">{days} días</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-xs h-7"
                  onClick={() => setStep("term")}
                >
                  Cambiar
                </Button>
              </div>

              {/* Calendar */}
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={selectDate}
                  locale={es}
                  className="rounded-md border"
                  modifiers={{
                    holiday: holidays.map((h) => h.date),
                  }}
                  modifiersStyles={{
                    holiday: {
                      backgroundColor: "hsl(var(--destructive) / 0.1)",
                      color: "hsl(var(--destructive))",
                      fontWeight: "bold",
                    },
                  }}
                />
              </div>

              {/* Date info */}
              {startDate && (
                <div className="flex items-center justify-center gap-2 text-sm">
                  {isBusinessDay(startDate) ? (
                    <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <CheckCircle className="h-3 w-3" />
                      Día hábil
                    </Badge>
                  ) : isColombianHoliday(startDate).isHoliday ? (
                    <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                      <PartyPopper className="h-3 w-3" />
                      {isColombianHoliday(startDate).name}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">Fin de semana</Badge>
                  )}
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep("term")}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Volver
                </Button>
              </div>
            </CardContent>
          </>
        )}

        {/* ==================== STEP 3: RESULT ==================== */}
        {step === "result" && result && (
          <>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="h-5 w-5 text-primary" />
                Resultado
              </CardTitle>
              <CardDescription>
                {selectedTerm === "custom"
                  ? `${days} días hábiles`
                  : COMMON_LEGAL_TERMS[selectedTerm!].name}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Urgency banner */}
              {(() => {
                const urgency = getUrgencyInfo(result.calendarDaysLeft);
                return (
                  <div className={cn("flex items-center gap-3 p-4 rounded-lg border", urgency.color)}>
                    {urgency.icon}
                    <span className="font-semibold">{urgency.label}</span>
                  </div>
                );
              })()}

              {/* Main result card */}
              <div className="rounded-lg border bg-muted/30 overflow-hidden">
                <div className="p-4 space-y-4">
                  {/* Start */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Fecha de inicio</p>
                      <p className="font-mono font-medium text-lg">
                        {formatDateCO(result.startDate)}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {format(result.startDate, "EEEE", { locale: es })}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1 px-4">
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs">
                        +{result.days} días hábiles
                      </Badge>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Vencimiento</p>
                      <p className="font-mono font-bold text-xl text-primary">
                        {formatDateCO(result.endDate)}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {format(result.endDate, "EEEE", { locale: es })}
                      </p>
                    </div>
                  </div>

                  {/* Holiday warning */}
                  {result.holidayCheck.isHoliday && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-2 p-3 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          El vencimiento cae en festivo: <strong>{result.holidayCheck.name}</strong>
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* CGP rule */}
                <div className="border-t bg-muted/50 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    <strong>Regla CGP:</strong> El cómputo inicia el día hábil siguiente a la fecha de
                    notificación o radicación. Excluye sábados, domingos y festivos.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={copyResult} variant="outline" className="flex-1 gap-2">
                  <Copy className="h-4 w-4" />
                  Copiar resultado
                </Button>
                <Button onClick={reset} variant="ghost" className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Nuevo cálculo
                </Button>
              </div>

              {/* Navigation */}
              <div className="flex justify-start pt-2">
                <Button variant="outline" onClick={() => setStep("date")}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Cambiar fecha
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
