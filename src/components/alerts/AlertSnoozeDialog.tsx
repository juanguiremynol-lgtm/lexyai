import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Clock, Loader2 } from "lucide-react";
import { format, addDays, addHours } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface AlertSnoozeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (snoozeUntil: Date) => void;
  isProcessing: boolean;
}

const SNOOZE_OPTIONS = [
  { label: "1 hora", value: () => addHours(new Date(), 1) },
  { label: "Mañana", value: () => addDays(new Date(), 1) },
  { label: "3 días", value: () => addDays(new Date(), 3) },
  { label: "7 días", value: () => addDays(new Date(), 7) },
];

export function AlertSnoozeDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isProcessing,
}: AlertSnoozeDialogProps) {
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [showCalendar, setShowCalendar] = useState(false);

  const handleQuickSnooze = (getDate: () => Date) => {
    onConfirm(getDate());
  };

  const handleCustomSnooze = () => {
    if (customDate) {
      onConfirm(customDate);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Posponer alertas
          </DialogTitle>
          <DialogDescription>
            {selectedCount} alerta{selectedCount !== 1 ? "s" : ""} será{selectedCount !== 1 ? "n" : ""} pospuesta{selectedCount !== 1 ? "s" : ""} y no aparecerá{selectedCount !== 1 ? "n" : ""} hasta la fecha seleccionada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant="outline"
                onClick={() => handleQuickSnooze(option.value)}
                disabled={isProcessing}
                className="justify-start"
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                O selecciona una fecha
              </span>
            </div>
          </div>

          <Popover open={showCalendar} onOpenChange={setShowCalendar}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !customDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customDate
                  ? format(customDate, "PPP", { locale: es })
                  : "Seleccionar fecha..."}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={(date) => {
                  setCustomDate(date);
                  setShowCalendar(false);
                }}
                disabled={(date) => date < new Date()}
                initialFocus
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCustomSnooze}
            disabled={!customDate || isProcessing}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Posponer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
