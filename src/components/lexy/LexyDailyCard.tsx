/**
 * LexyDailyCard — Shows Lexy's daily message on the dashboard
 *
 * Only visible when there's an unseen message for today.
 * Dismissible via "Cerrar" button which sets seen_at.
 */

import { useLexyDailyMessage } from "@/hooks/useLexyDailyMessage";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, MessageSquare, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function LexyDailyCard() {
  const { message, isNew, dismiss } = useLexyDailyMessage();
  const navigate = useNavigate();

  if (!isNew || !message) return null;

  const dateStr = format(new Date(), "d 'de' MMMM, yyyy", { locale: es });

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5 shadow-lg mb-6 overflow-hidden relative">
      {/* Decorative accent */}
      <div className="absolute top-0 left-0 w-1 h-full bg-primary rounded-l" />

      <CardContent className="p-5 pl-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="font-semibold text-sm text-foreground">Lexy</span>
              <span className="text-xs text-muted-foreground ml-1.5">· Tu asistente de ATENIA</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{dateStr}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={dismiss}
              aria-label="Cerrar mensaje"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Greeting */}
        <p className="text-sm text-foreground font-medium mb-2">{message.greeting}</p>

        {/* Highlights */}
        {message.highlights && message.highlights.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {message.highlights.map((h: { icon: string; text: string }, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 mt-0.5">{h.icon}</span>
                <span className="text-muted-foreground">{h.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <p className="text-sm text-muted-foreground mb-3">{message.summary_body}</p>

        {/* Closing */}
        {message.closing && (
          <p className="text-xs text-muted-foreground italic mb-3">{message.closing}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {message.new_publicaciones_count > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => navigate("/hoy/estados")}
            >
              Ver estados de hoy
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
          {message.new_actuaciones_count > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => navigate("/hoy/actuaciones")}
            >
              Ver actuaciones
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
