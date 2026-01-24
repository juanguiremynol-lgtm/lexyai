import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Radio, Loader2 } from "lucide-react";
import { useTickerSettings, useToggleTickerSetting } from "@/hooks/use-ticker-estados";
import { toast } from "sonner";

export function TickerSettings() {
  const { showTicker, isLoading } = useTickerSettings();
  const toggleMutation = useToggleTickerSetting();

  const handleToggle = async (checked: boolean) => {
    try {
      await toggleMutation.mutateAsync(checked);
      toast.success(checked ? "Ticker activado" : "Ticker desactivado");
    } catch (error) {
      toast.error("Error al cambiar configuración del ticker");
    }
  };

  if (isLoading) {
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
          <Radio className="h-5 w-5 text-destructive" />
          Ticker de Estados en Vivo
        </CardTitle>
        <CardDescription>
          Muestra un banner con las últimas actuaciones judiciales importadas. 
          Visible en toda la aplicación cuando está activo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ticker-toggle" className="text-base">
              Mostrar ticker de actualizaciones
            </Label>
            <p className="text-sm text-muted-foreground">
              Actualiza automáticamente cada 60 segundos con los últimos estados de CGP, CPACA, Tutelas y Laborales.
            </p>
          </div>
          <Switch
            id="ticker-toggle"
            checked={showTicker}
            onCheckedChange={handleToggle}
            disabled={toggleMutation.isPending}
          />
        </div>

        {showTicker && (
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">💡 Consejo</p>
            <p>
              Haz clic en cualquier elemento del ticker para ir directamente al detalle del proceso. 
              Pasa el mouse sobre el ticker para pausar el desplazamiento.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TickerSettings;
