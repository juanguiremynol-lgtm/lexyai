/**
 * AndroiaFeedbackForm — Modal form for collecting user feedback.
 * Collects: feedback type (peticion/felicitacion/queja/comentario), name, email, and message.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AndroiaFeedbackFormProps {
  isOpen: boolean;
  onClose: () => void;
}

const FEEDBACK_TYPES = [
  { value: "peticion", label: "Petición", icon: "📝" },
  { value: "felicitacion", label: "Felicitación", icon: "⭐" },
  { value: "queja", label: "Queja", icon: "⚠️" },
  { value: "comentario", label: "Comentario", icon: "💬" },
];

export function AndroiaFeedbackForm({ isOpen, onClose }: AndroiaFeedbackFormProps) {
  const queryClient = useQueryClient();
  const [feedbackType, setFeedbackType] = useState<string>("comentario");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!name.trim()) {
      toast.error("Por favor ingresa tu nombre");
      return;
    }
    if (!email.trim()) {
      toast.error("Por favor ingresa tu email");
      return;
    }
    if (!email.includes("@")) {
      toast.error("Por favor ingresa un email válido");
      return;
    }
    if (!message.trim()) {
      toast.error("Por favor ingresa tu mensaje");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user ? await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle() : { data: null };

      const { error } = await supabase
        .from("user_feedback")
        .insert({
          feedback_type: feedbackType,
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          user_id: user?.id || null,
          organization_id: profile?.organization_id || null,
        });

      if (error) throw error;

      toast.success("¡Gracias por tu feedback! Lo revisaremos pronto.");
      setName("");
      setEmail("");
      setMessage("");
      setFeedbackType("comentario");
      onClose();

      queryClient.invalidateQueries({ queryKey: ["user-feedback"] });
    } catch (err) {
      console.error("Feedback submission error:", err);
      toast.error("Error al enviar tu feedback. Intenta nuevamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">Enviar Feedback a Andro IA</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tu opinión nos ayuda a mejorar la plataforma
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Feedback Type Selection */}
          <div className="space-y-2">
            <Label htmlFor="feedback-type" className="text-sm font-medium">
              Tipo de feedback
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setFeedbackType(type.value)}
                  className={cn(
                    "flex items-center justify-center gap-2 px-3 py-2 rounded-md border transition-colors text-sm font-medium",
                    feedbackType === type.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
                  )}
                >
                  <span>{type.icon}</span>
                  <span>{type.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-medium">
              Nombre *
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email *
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message" className="text-sm font-medium">
              Mensaje *
            </Label>
            <Textarea
              id="message"
              placeholder="Cuéntanos qué piensas..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
              className="resize-none"
              rows={4}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
