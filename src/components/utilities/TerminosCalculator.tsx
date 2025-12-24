import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Calculator, 
  CalendarDays, 
  Copy, 
  RotateCcw, 
  ArrowRight,
  Clock,
  AlertTriangle,
  CheckCircle,
  PartyPopper,
  Info
} from "lucide-react";
import { format, getYear } from "date-fns";
import { es } from "date-fns/locale";
import { 
  addBusinessDays, 
  getColombianHolidays, 
  isBusinessDay, 
  isColombianHoliday,
  formatDateCO,
  COMMON_LEGAL_TERMS,
  LegalTermType
} from "@/lib/colombian-holidays";
import { cn } from "@/lib/utils";

export function TerminosCalculator() {
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [businessDays, setBusinessDays] = useState<string>("10");
  const [selectedTerm, setSelectedTerm] = useState<LegalTermType | "custom">("tutela");
  const [showHolidays, setShowHolidays] = useState(false);

  // Get holidays for current and next year
  const holidays = useMemo(() => {
    const currentYear = getYear(new Date());
    return [
      ...getColombianHolidays(currentYear),
      ...getColombianHolidays(currentYear + 1),
    ];
  }, []);

  // Calculate result
  const result = useMemo(() => {
    if (!startDate) return null;
    
    const days = selectedTerm === "custom" 
      ? parseInt(businessDays) || 0
      : COMMON_LEGAL_TERMS[selectedTerm].days;
    
    if (days <= 0) return null;
    
    const endDate = addBusinessDays(startDate, days);
    const holidayCheck = isColombianHoliday(endDate);
    const isWorkDay = isBusinessDay(endDate);
    
    return {
      startDate,
      endDate,
      days,
      holidayCheck,
      isWorkDay,
    };
  }, [startDate, businessDays, selectedTerm]);

  const handleTermChange = (value: LegalTermType | "custom") => {
    setSelectedTerm(value);
    if (value !== "custom") {
      setBusinessDays(COMMON_LEGAL_TERMS[value].days.toString());
    }
  };

  const copyResult = async () => {
    if (!result) return;
    const text = `Fecha inicio: ${formatDateCO(result.startDate)}\nDías hábiles: ${result.days}\nVencimiento: ${formatDateCO(result.endDate)}`;
    await navigator.clipboard.writeText(text);
    toast.success("Resultado copiado al portapapeles");
  };

  const reset = () => {
    setStartDate(new Date());
    setBusinessDays("10");
    setSelectedTerm("tutela");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Calculator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Calculadora de Términos
          </CardTitle>
          <CardDescription>
            Calcule vencimientos según el Código General del Proceso. El conteo inicia desde el día siguiente hábil.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Term Type Selection */}
          <div className="space-y-2">
            <Label>Tipo de término</Label>
            <Select value={selectedTerm} onValueChange={(v) => handleTermChange(v as LegalTermType | "custom")}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccione el tipo" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COMMON_LEGAL_TERMS).map(([key, term]) => (
                  <SelectItem key={key} value={key}>
                    {term.name} — {term.days} días
                  </SelectItem>
                ))}
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {selectedTerm !== "custom" && (
              <p className="text-xs text-muted-foreground">
                {COMMON_LEGAL_TERMS[selectedTerm].description}
              </p>
            )}
          </div>

          {/* Start Date */}
          <div className="space-y-2">
            <Label>Fecha de radicación / notificación</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, "PPP", { locale: es }) : "Seleccione fecha"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  locale={es}
                  modifiers={{
                    holiday: holidays.map(h => h.date),
                  }}
                  modifiersStyles={{
                    holiday: { 
                      backgroundColor: "hsl(var(--destructive) / 0.1)",
                      color: "hsl(var(--destructive))",
                      fontWeight: "bold"
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
            {startDate && (
              <div className="flex items-center gap-2 text-xs">
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
                  <Badge variant="secondary" className="gap-1">
                    Fin de semana
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Business Days */}
          <div className="space-y-2">
            <Label>Días hábiles</Label>
            <Input
              type="number"
              min="1"
              max="365"
              value={businessDays}
              onChange={(e) => {
                setBusinessDays(e.target.value);
                setSelectedTerm("custom");
              }}
              placeholder="Ej: 10"
            />
            <p className="text-xs text-muted-foreground">
              Excluye sábados, domingos y festivos oficiales colombianos.
            </p>
          </div>

          {/* Result */}
          {result && (
            <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Fecha inicio:</span>
                <span className="font-mono font-medium">{formatDateCO(result.startDate)}</span>
              </div>
              <div className="flex items-center justify-center">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="ml-2">
                  + {result.days} días hábiles
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Vencimiento:</span>
                <span className="font-mono font-bold text-lg">{formatDateCO(result.endDate)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Día de vencimiento:</span>
                <span className="capitalize">
                  {format(result.endDate, "EEEE", { locale: es })}
                </span>
              </div>
              {result.holidayCheck.isHoliday && (
                <div className="flex items-center gap-2 p-2 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  Cae en festivo: {result.holidayCheck.name}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={copyResult} disabled={!result} variant="outline" className="flex-1 gap-2">
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
            <Button onClick={reset} variant="ghost" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Reiniciar
            </Button>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-sm">
            <Info className="h-4 w-4 text-blue-600 mt-0.5" />
            <p className="text-blue-800 dark:text-blue-300">
              <strong>Regla CGP:</strong> El cómputo de términos se inicia a partir del día siguiente hábil 
              a la fecha de notificación o radicación.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Holidays List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PartyPopper className="h-5 w-5" />
            Calendario de Festivos
          </CardTitle>
          <CardDescription>
            Festivos oficiales colombianos (Ley 51 de 1983 / Ley Emiliani)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-4">
              {[getYear(new Date()), getYear(new Date()) + 1].map(year => (
                <div key={year}>
                  <h3 className="font-semibold text-lg mb-3 sticky top-0 bg-card py-2">{year}</h3>
                  <div className="space-y-2">
                    {getColombianHolidays(year).map((h, idx) => {
                      const isPast = h.date < new Date();
                      return (
                        <div 
                          key={idx} 
                          className={cn(
                            "flex items-center justify-between p-2 rounded-lg border",
                            isPast ? "opacity-50" : "bg-muted/30"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono text-sm">{formatDateCO(h.date)}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{h.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
