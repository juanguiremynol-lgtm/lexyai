import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Bell, Mail, Clock, Loader2, Save, FileSpreadsheet } from "lucide-react";
import { useStalenessSettings, useUpdateStalenessSettings, useLastIngestion, calculateStalenessInfo } from "@/hooks/use-staleness-alerts";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useState } from "react";

export function StalenessAlertSettings() {
  const { data: settings, isLoading: settingsLoading } = useStalenessSettings();
  const { data: lastIngestion, isLoading: ingestionLoading } = useLastIngestion();
  const updateSettings = useUpdateStalenessSettings();
  
  const [thresholdDays, setThresholdDays] = useState<number | null>(null);

  const stalenessInfo = calculateStalenessInfo(
    lastIngestion?.created_at || null,
    settings?.thresholdDays || 3
  );

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      await updateSettings.mutateAsync({ enabled: checked });
      toast.success(checked ? "Alertas de estados activadas" : "Alertas de estados desactivadas");
    } catch (error) {
      toast.error("Error al cambiar configuración");
    }
  };

  const handleToggleEmail = async (checked: boolean) => {
    try {
      await updateSettings.mutateAsync({ emailEnabled: checked });
      toast.success(checked ? "Notificaciones por correo activadas" : "Notificaciones por correo desactivadas");
    } catch (error) {
      toast.error("Error al cambiar configuración");
    }
  };

  const handleSaveThreshold = async () => {
    if (thresholdDays === null || thresholdDays < 1 || thresholdDays > 30) {
      toast.error("El umbral debe estar entre 1 y 30 días hábiles");
      return;
    }
    try {
      await updateSettings.mutateAsync({ thresholdDays });
      toast.success("Umbral de días actualizado");
    } catch (error) {
      toast.error("Error al guardar umbral");
    }
  };

  if (settingsLoading || ingestionLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Alertas de Actualización de Estados
        </CardTitle>
        <CardDescription>
          Reciba alertas cuando no haya importado estados de ICARUS en un período de tiempo.
          Esto ayuda a mantener los términos y actuaciones al día.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status indicator */}
        <div className="p-4 rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Última importación de Estados</span>
            </div>
            {stalenessInfo.isStale ? (
              <Badge variant="destructive">Desactualizado</Badge>
            ) : (
              <Badge variant="default">Al día</Badge>
            )}
          </div>
          
          {lastIngestion ? (
            <div className="text-sm text-muted-foreground">
              <p>
                <Clock className="h-3 w-3 inline mr-1" />
                {format(new Date(lastIngestion.created_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                {" · "}
                {formatDistanceToNow(new Date(lastIngestion.created_at), { addSuffix: true, locale: es })}
              </p>
              {stalenessInfo.businessDaysSinceIngestion !== null && (
                <p className="mt-1">
                  {stalenessInfo.businessDaysSinceIngestion} día(s) hábil(es) desde la última importación
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No se ha importado ningún archivo de estados aún.
            </p>
          )}
        </div>

        {/* Enable/disable alerts */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="staleness-toggle" className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alertas de actualización pendiente
            </Label>
            <p className="text-sm text-muted-foreground">
              Mostrar alerta en la aplicación cuando no haya importado estados en el período configurado.
            </p>
          </div>
          <Switch
            id="staleness-toggle"
            checked={settings?.enabled ?? true}
            onCheckedChange={handleToggleEnabled}
            disabled={updateSettings.isPending}
          />
        </div>

        {/* Email notifications */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="staleness-email-toggle" className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Notificaciones por correo
            </Label>
            <p className="text-sm text-muted-foreground">
              Recibir correo electrónico diario cuando los estados estén desactualizados.
            </p>
          </div>
          <Switch
            id="staleness-email-toggle"
            checked={settings?.emailEnabled ?? true}
            onCheckedChange={handleToggleEmail}
            disabled={updateSettings.isPending || !settings?.enabled}
          />
        </div>

        {/* Threshold days */}
        <div className="space-y-2">
          <Label htmlFor="threshold-days" className="text-base">
            Umbral de días hábiles
          </Label>
          <p className="text-sm text-muted-foreground mb-2">
            Número de días hábiles sin importar estados antes de generar la alerta.
          </p>
          <div className="flex gap-2 items-center">
            <Input
              id="threshold-days"
              type="number"
              min={1}
              max={30}
              defaultValue={settings?.thresholdDays ?? 3}
              onChange={(e) => setThresholdDays(parseInt(e.target.value) || null)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">días hábiles</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveThreshold}
              disabled={updateSettings.isPending || thresholdDays === null}
            >
              <Save className="h-4 w-4 mr-1" />
              Guardar
            </Button>
          </div>
        </div>

        {/* Info box */}
        {settings?.enabled && (
          <div className="rounded-lg bg-accent/50 p-4 text-sm border border-border">
            <p className="font-medium text-foreground mb-1">
              💡 ¿Cómo funciona?
            </p>
            <p className="text-muted-foreground">
              Si pasan {settings?.thresholdDays || 3} días hábiles sin importar un archivo de ICARUS Estados, 
              se mostrará una alerta en la página de Alertas y en el Dashboard. 
              {settings?.emailEnabled && " Además, recibirá un correo diario hasta que importe el archivo."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StalenessAlertSettings;
