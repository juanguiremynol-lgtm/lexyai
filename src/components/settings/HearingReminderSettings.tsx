import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Bell, Save } from "lucide-react";
import { toast } from "sonner";

interface HearingReminderSettingsProps {
  profile: {
    id: string;
    hearing_reminder_days?: number[] | null;
  } | null;
}

const AVAILABLE_REMINDER_DAYS = [
  { value: 0, label: "El mismo día" },
  { value: 1, label: "1 día antes" },
  { value: 2, label: "2 días antes" },
  { value: 3, label: "3 días antes" },
  { value: 5, label: "5 días antes" },
  { value: 7, label: "7 días antes" },
  { value: 14, label: "14 días antes" },
];

export function HearingReminderSettings({ profile }: HearingReminderSettingsProps) {
  const queryClient = useQueryClient();
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 3, 7]);

  useEffect(() => {
    if (profile?.hearing_reminder_days) {
      // Handle both array and JSON formats
      const days = Array.isArray(profile.hearing_reminder_days)
        ? profile.hearing_reminder_days
        : [];
      setSelectedDays(days);
    }
  }, [profile]);

  const updateReminderDays = useMutation({
    mutationFn: async (days: number[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { error } = await supabase
        .from("profiles")
        .update({ hearing_reminder_days: days })
        .eq("id", user.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Intervalos de recordatorio guardados");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const toggleDay = (day: number) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        return prev.filter(d => d !== day);
      } else {
        return [...prev, day].sort((a, b) => a - b);
      }
    });
  };

  const handleSave = () => {
    if (selectedDays.length === 0) {
      toast.error("Seleccione al menos un intervalo de recordatorio");
      return;
    }
    updateReminderDays.mutate(selectedDays);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Recordatorios de Audiencias
        </CardTitle>
        <CardDescription>
          Configure cuántos días antes de una audiencia desea recibir recordatorios por correo electrónico
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label className="text-sm font-medium">Enviar recordatorio:</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {AVAILABLE_REMINDER_DAYS.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`reminder-${option.value}`}
                  checked={selectedDays.includes(option.value)}
                  onCheckedChange={() => toggleDay(option.value)}
                />
                <Label
                  htmlFor={`reminder-${option.value}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {option.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg">
          <p className="text-sm text-muted-foreground">
            <strong>Intervalos seleccionados:</strong>{" "}
            {selectedDays.length === 0
              ? "Ninguno"
              : selectedDays
                  .map(d => d === 0 ? "mismo día" : `${d} día${d !== 1 ? "s" : ""}`)
                  .join(", ")}
          </p>
        </div>

        <Button 
          onClick={handleSave} 
          disabled={updateReminderDays.isPending}
        >
          <Save className="h-4 w-4 mr-2" />
          Guardar configuración
        </Button>
      </CardContent>
    </Card>
  );
}
