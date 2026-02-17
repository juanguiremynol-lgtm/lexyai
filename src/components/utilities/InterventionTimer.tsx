import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  AlarmClock,
  Clock,
  BellRing,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "5 min", seconds: 5 * 60 },
  { label: "10 min", seconds: 10 * 60 },
  { label: "20 min", seconds: 20 * 60 },
];

const SNOOZE_OPTIONS = [
  { label: "+1 min", seconds: 60 },
  { label: "+2 min", seconds: 120 },
  { label: "+5 min", seconds: 300 },
];

type TimerState = "idle" | "running" | "paused" | "finished";

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function InterventionTimer() {
  const [totalSeconds, setTotalSeconds] = useState(5 * 60);
  const [remaining, setRemaining] = useState(5 * 60);
  const [state, setState] = useState<TimerState>("idle");
  const [customMinutes, setCustomMinutes] = useState(5);
  const [alertOpen, setAlertOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const progress = totalSeconds > 0 ? ((totalSeconds - remaining) / totalSeconds) * 100 : 0;

  const playAlertSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      audioRef.current = ctx;
      const playBeep = (time: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
        osc.start(time);
        osc.stop(time + 0.3);
      };
      // Three ascending beeps
      playBeep(ctx.currentTime, 660);
      playBeep(ctx.currentTime + 0.4, 880);
      playBeep(ctx.currentTime + 0.8, 1100);
    } catch {
      // Audio not available
    }
  }, []);

  const stopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.close();
      audioRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleFinish = useCallback(() => {
    clearTimer();
    setState("finished");
    setAlertOpen(true);
    playAlertSound();
    // Update document title as visual alert
    document.title = "⏰ ¡Tiempo agotado! — Atenia";
  }, [clearTimer, playAlertSound]);

  useEffect(() => {
    if (state === "running") {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          if (prev <= 1) {
            handleFinish();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [state, clearTimer, handleFinish]);

  // Restore title on unmount or dismiss
  useEffect(() => {
    return () => {
      document.title = "Atenia";
    };
  }, []);

  const selectPreset = (seconds: number) => {
    clearTimer();
    setTotalSeconds(seconds);
    setRemaining(seconds);
    setCustomMinutes(seconds / 60);
    setState("idle");
  };

  const applyCustom = () => {
    const secs = Math.max(1, Math.round(customMinutes * 60));
    setTotalSeconds(secs);
    setRemaining(secs);
    setState("idle");
  };

  const start = () => setState("running");
  const pause = () => setState("paused");
  const resume = () => setState("running");

  const reset = () => {
    clearTimer();
    setRemaining(totalSeconds);
    setState("idle");
    stopSound();
    document.title = "Atenia";
  };

  const snooze = (extraSeconds: number) => {
    stopSound();
    setAlertOpen(false);
    document.title = "Atenia";
    const newTotal = extraSeconds;
    setTotalSeconds(newTotal);
    setRemaining(newTotal);
    setState("running");
  };

  const dismiss = () => {
    stopSound();
    setAlertOpen(false);
    document.title = "Atenia";
    setState("idle");
    setRemaining(totalSeconds);
  };

  const isLargeDisplay = state === "running" || state === "paused" || state === "finished";

  return (
    <>
      <Card className="max-w-lg mx-auto">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Timer className="h-5 w-5 text-primary" />
            Cronómetro de Intervención
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Large time display */}
          <div
            className={cn(
              "text-center py-6 rounded-xl transition-all",
              state === "finished"
                ? "bg-destructive/10 border-2 border-destructive animate-pulse"
                : state === "running"
                ? "bg-primary/5 border border-primary/20"
                : "bg-muted/50 border border-border"
            )}
          >
            <div
              className={cn(
                "font-mono font-bold tracking-wider transition-all",
                isLargeDisplay ? "text-6xl md:text-7xl" : "text-5xl md:text-6xl",
                state === "finished"
                  ? "text-destructive"
                  : state === "running"
                  ? "text-primary"
                  : "text-foreground"
              )}
            >
              {formatTime(remaining)}
            </div>
            {state === "running" && (
              <p className="text-sm text-muted-foreground mt-2">En curso</p>
            )}
            {state === "paused" && (
              <p className="text-sm text-muted-foreground mt-2">Pausado</p>
            )}
            {state === "finished" && (
              <p className="text-sm text-destructive font-semibold mt-2 flex items-center justify-center gap-1">
                <BellRing className="h-4 w-4" />
                ¡Tiempo agotado!
              </p>
            )}
          </div>

          {/* Progress bar */}
          {(state === "running" || state === "paused") && (
            <Progress value={progress} className="h-2" />
          )}

          {/* Presets */}
          {(state === "idle" || state === "finished") && (
            <div className="space-y-3">
              <Label className="text-sm font-medium text-muted-foreground">
                Preajustes
              </Label>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.seconds}
                    variant={totalSeconds === p.seconds ? "default" : "outline"}
                    size="sm"
                    onClick={() => selectPreset(p.seconds)}
                    className="flex-1"
                  >
                    <Clock className="h-3.5 w-3.5 mr-1.5" />
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Custom duration */}
          {(state === "idle" || state === "finished") && (
            <div className="space-y-3">
              <Label className="text-sm font-medium text-muted-foreground">
                Duración personalizada
              </Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[customMinutes]}
                  onValueChange={([v]) => setCustomMinutes(v)}
                  min={1}
                  max={120}
                  step={1}
                  className="flex-1"
                />
                <div className="flex items-center gap-1.5 min-w-[100px]">
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={customMinutes}
                    onChange={(e) =>
                      setCustomMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                    }
                    className="w-16 h-9 text-center text-sm"
                  />
                  <span className="text-sm text-muted-foreground">min</span>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={applyCustom}
                className="w-full"
              >
                <AlarmClock className="h-3.5 w-3.5 mr-1.5" />
                Establecer {customMinutes} min
              </Button>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-2 justify-center">
            {state === "idle" && (
              <Button onClick={start} size="lg" className="flex-1 max-w-[200px]">
                <Play className="h-4 w-4 mr-2" />
                Iniciar
              </Button>
            )}
            {state === "running" && (
              <>
                <Button onClick={pause} variant="outline" size="lg" className="flex-1 max-w-[150px]">
                  <Pause className="h-4 w-4 mr-2" />
                  Pausar
                </Button>
                <Button onClick={reset} variant="ghost" size="lg">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reiniciar
                </Button>
              </>
            )}
            {state === "paused" && (
              <>
                <Button onClick={resume} size="lg" className="flex-1 max-w-[150px]">
                  <Play className="h-4 w-4 mr-2" />
                  Reanudar
                </Button>
                <Button onClick={reset} variant="ghost" size="lg">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reiniciar
                </Button>
              </>
            )}
            {state === "finished" && (
              <Button onClick={reset} variant="outline" size="lg" className="flex-1 max-w-[200px]">
                <RotateCcw className="h-4 w-4 mr-2" />
                Nuevo temporizador
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Full-screen alert dialog */}
      <Dialog open={alertOpen} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-md border-destructive/50"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-xl">
              <BellRing className="h-6 w-6 animate-bounce" />
              ¡Tiempo agotado!
            </DialogTitle>
            <DialogDescription className="text-base">
              El temporizador de{" "}
              <span className="font-semibold text-foreground">
                {formatTime(totalSeconds)}
              </span>{" "}
              ha finalizado. Puede posponer o cerrar la alerta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Posponer
              </Label>
              <div className="flex gap-2">
                {SNOOZE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.seconds}
                    variant="outline"
                    onClick={() => snooze(opt.seconds)}
                    className="flex-1"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={dismiss} className="w-full" variant="destructive">
              <X className="h-4 w-4 mr-2" />
              Cerrar alerta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
