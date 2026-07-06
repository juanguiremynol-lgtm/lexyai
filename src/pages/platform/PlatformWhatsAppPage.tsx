/**
 * Platform WhatsApp Page — Super Admin placeholder for the future
 * WhatsApp attention agent (inbox, leads, identities, settings).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Users, Inbox, Settings2, ShieldCheck } from "lucide-react";

export default function PlatformWhatsAppPage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <MessageCircle className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-serif font-bold">WhatsApp</h2>
            <Badge variant="outline" className="uppercase tracking-wider text-xs">
              Próximamente
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Agente de atención al cliente vía WhatsApp para clientes actuales y prospectos.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Módulo en preparación</CardTitle>
          <CardDescription>
            Este espacio alojará la consola completa del agente de WhatsApp de Andrómeda Legal.
            La infraestructura se irá agregando aquí en próximas iteraciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <PlaceholderTile
            icon={<Inbox className="h-4 w-4" />}
            title="Bandeja de conversaciones"
            description="Vista unificada de mensajes entrantes y salientes, con posibilidad de tomar la conversación del bot."
          />
          <PlaceholderTile
            icon={<Users className="h-4 w-4" />}
            title="Leads / Prospectos"
            description="Registro de nuevos prospectos capturados por el bot, con estado y asignación."
          />
          <PlaceholderTile
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Identidades verificadas"
            description="Números vinculados a usuarios, con opción de desvincular o bloquear."
          />
          <PlaceholderTile
            icon={<Settings2 className="h-4 w-4" />}
            title="Configuración"
            description="Horario de atención, límites de mensajes, correo de notificaciones y base de conocimiento de servicios."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderTile({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-4 bg-muted/20">
      <div className="flex items-center gap-2 mb-1 text-sm font-medium">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
