/**
 * ROI Calculator Section — Landing page conversion tool
 * 
 * Inputs: number of processes, notifications per week, team size.
 * Outputs: estimated hours saved + recommended plan.
 * Launch-gated CTA: waitlist pre-launch, signup when live.
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLaunchGate } from "@/hooks/use-launch-gate";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Calculator, ArrowRight, Clock, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanRecommendation {
  name: string;
  reason: string;
  highlight: boolean;
}

function calculateROI(processes: number, notificationsPerWeek: number, teamSize: number) {
  // Hours saved per month estimation
  const hoursPerProcessPerMonth = 2.5; // Manual tracking time
  const hoursPerNotificationPerWeek = 0.15; // Time reading/processing each notification
  const adminOverheadPerMember = 1.5; // Monthly admin overhead per team member

  const processSavings = processes * hoursPerProcessPerMonth * 0.8; // 80% automation
  const notificationSavings = notificationsPerWeek * 4 * hoursPerNotificationPerWeek * 0.9;
  const adminSavings = teamSize > 1 ? (teamSize - 1) * adminOverheadPerMember * 0.7 : 0;

  const totalHoursSaved = Math.round(processSavings + notificationSavings + adminSavings);

  // Plan recommendation
  let plan: PlanRecommendation;
  if (teamSize > 3 || processes > 50) {
    plan = {
      name: "Business",
      reason: "Ideal para equipos con gestión compartida y reportes avanzados",
      highlight: true,
    };
  } else if (processes > 15 || notificationsPerWeek > 20) {
    plan = {
      name: "Plus",
      reason: "Perfecto para volumen medio con alertas avanzadas",
      highlight: true,
    };
  } else {
    plan = {
      name: "Básico",
      reason: "Todo lo que necesitas para empezar a automatizar",
      highlight: false,
    };
  }

  return { totalHoursSaved, plan };
}

export function ROICalculatorSection() {
  const navigate = useNavigate();
  const { isLive } = useLaunchGate();
  const [processes, setProcesses] = useState(10);
  const [notifications, setNotifications] = useState(15);
  const [teamSize, setTeamSize] = useState(1);
  const [hasInteracted, setHasInteracted] = useState(false);

  const { totalHoursSaved, plan } = useMemo(
    () => calculateROI(processes, notifications, teamSize),
    [processes, notifications, teamSize]
  );

  const handleSliderChange = (setter: (v: number) => void) => (value: number[]) => {
    setter(value[0]);
    if (!hasInteracted) {
      setHasInteracted(true);
      track(ANALYTICS_EVENTS.LANDING_CALCULATOR_INTERACTED, {});
    }
  };

  const handleCTAClick = () => {
    track(ANALYTICS_EVENTS.LANDING_PLAN_RECOMMENDATION_CLICK, {
      plan_name: plan.name,
      processes_count: processes,
      team_size: teamSize,
    });
    if (isLive) {
      navigate("/auth");
    } else {
      // Scroll to waitlist or navigate
      const waitlistEl = document.getElementById("waitlist");
      if (waitlistEl) {
        waitlistEl.scrollIntoView({ behavior: "smooth" });
      } else {
        navigate("/");
      }
    }
  };

  return (
    <section className="py-20 md:py-28 bg-gradient-to-b from-muted/20 to-background">
      <div className="container max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-primary mb-3">
            Calculadora de ahorro
          </span>
          <h2 className="text-3xl md:text-4xl font-display font-bold tracking-tight text-foreground mb-4">
            ¿Cuánto tiempo puedes ahorrar?
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Ajusta los valores a tu realidad y descubre cuántas horas al mes puedes dedicar 
            a lo que realmente importa: tus clientes.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 items-start">
          {/* Inputs */}
          <div className="space-y-8 p-6 md:p-8 rounded-2xl border border-border/50 bg-card/50">
            {/* Processes */}
            <div className="space-y-3">
              <div className="flex justify-between items-baseline">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-primary" />
                  Procesos activos
                </label>
                <span className="text-2xl font-bold text-primary tabular-nums">{processes}</span>
              </div>
              <Slider
                value={[processes]}
                onValueChange={handleSliderChange(setProcesses)}
                min={1}
                max={200}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>200+</span>
              </div>
            </div>

            {/* Notifications */}
            <div className="space-y-3">
              <div className="flex justify-between items-baseline">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Notificaciones / semana
                </label>
                <span className="text-2xl font-bold text-primary tabular-nums">{notifications}</span>
              </div>
              <Slider
                value={[notifications]}
                onValueChange={handleSliderChange(setNotifications)}
                min={1}
                max={100}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>100+</span>
              </div>
            </div>

            {/* Team Size */}
            <div className="space-y-3">
              <div className="flex justify-between items-baseline">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Tamaño del equipo
                </label>
                <span className="text-2xl font-bold text-primary tabular-nums">{teamSize}</span>
              </div>
              <Slider
                value={[teamSize]}
                onValueChange={handleSliderChange(setTeamSize)}
                min={1}
                max={20}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 (individual)</span>
                <span>20+</span>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className="flex flex-col gap-6">
            {/* Hours saved */}
            <div className="relative p-8 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 text-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
              <div className="relative">
                <TrendingUp className="h-8 w-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground mb-1">Horas ahorradas al mes</p>
                <p className="text-5xl md:text-6xl font-bold text-primary tabular-nums">
                  {totalHoursSaved}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  ≈ {Math.round(totalHoursSaved / 8)} días laborales
                </p>
              </div>
            </div>

            {/* Plan recommendation */}
            <div className={cn(
              "p-6 rounded-2xl border text-center",
              plan.highlight
                ? "border-primary/40 bg-primary/5"
                : "border-border/50 bg-card/50"
            )}>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
                Plan recomendado
              </p>
              <p className="text-2xl font-bold text-foreground mb-1">{plan.name}</p>
              <p className="text-sm text-muted-foreground mb-4">{plan.reason}</p>
              <Button
                size="lg"
                className="w-full h-12 text-base"
                onClick={handleCTAClick}
              >
                {isLive ? "Comenzar gratis — 3 meses" : "Unirme a la lista de espera"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              * Estimación basada en promedios del sector jurídico colombiano. 
              Resultados reales pueden variar.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
