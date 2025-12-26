/**
 * Alert Configuration Section for creation dialogs
 * Optional section to configure alerts when creating items
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell } from "lucide-react";

export interface AlertConfig {
  enabled: boolean;
  frequency: number;
  inApp: boolean;
  email: boolean;
}

interface AlertConfigSectionProps {
  config: AlertConfig;
  onChange: (config: AlertConfig) => void;
  showFrequency?: boolean;
  title?: string;
  description?: string;
}

export function AlertConfigSection({
  config,
  onChange,
  showFrequency = true,
  title = "Alertas (Opcional)",
  description = "Configure recordatorios para este ítem",
}: AlertConfigSectionProps) {
  const handleChange = (key: keyof AlertConfig, value: boolean | number) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <Label className="font-medium">{title}</Label>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => handleChange("enabled", checked)}
        />
      </div>

      {config.enabled && (
        <div className="space-y-4 pl-6 animate-in slide-in-from-top-2">
          <p className="text-sm text-muted-foreground">{description}</p>

          {/* Channels */}
          <div className="space-y-2">
            <Label className="text-sm">Canales de notificación</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={config.inApp}
                  onCheckedChange={(checked) => handleChange("inApp", checked === true)}
                />
                <span className="text-sm">En la aplicación</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={config.email}
                  onCheckedChange={(checked) => handleChange("email", checked === true)}
                />
                <span className="text-sm">Correo electrónico</span>
              </label>
            </div>
          </div>

          {/* Frequency selector */}
          {showFrequency && (
            <div className="space-y-2">
              <Label className="text-sm">Frecuencia de recordatorios</Label>
              <Select
                value={config.frequency.toString()}
                onValueChange={(v) => handleChange("frequency", parseInt(v))}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Cada 1 día</SelectItem>
                  <SelectItem value="3">Cada 3 días</SelectItem>
                  <SelectItem value="5">Cada 5 días</SelectItem>
                  <SelectItem value="7">Cada 7 días</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
