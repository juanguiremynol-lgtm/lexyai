/**
 * AteniaOperatorExplanation — Operator explanation card in Spanish
 *
 * Describes what Atenia AI does automatically and what it will never do.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, ShieldCheck } from "lucide-react";

export function AteniaOperatorExplanation() {
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          ¿Qué hace Atenia AI automáticamente?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <h4 className="font-semibold text-foreground flex items-center gap-1.5 mb-1">
            ✅ Acciones automáticas (reversibles y auditadas)
          </h4>
          <ul className="space-y-1 text-muted-foreground ml-4 list-disc">
            <li>Detecta asuntos "fantasma" (monitoreo activo sin datos) y programa reintentos con backoff exponencial.</li>
            <li>Suspende monitoreo automáticamente tras 5 consultas consecutivas sin resultado (NOT_FOUND). El usuario puede reactivarlo con un clic.</li>
            <li>Separa sincronización de actuaciones y publicaciones en casos pesados (PENAL_906 con 100+ actuaciones) para evitar timeouts.</li>
            <li>Programa re-consultas para scrapers CPNU que lanzan jobs asíncronos.</li>
            <li>Detecta proveedores degradados (tasa de error &gt;30%) y suprime reintentos masivos para no empeorar la situación.</li>
            <li>Monitorea proveedores externos: instancias PLATFORM faltantes, mappings en borrador, snapshots fallidos.</li>
            <li>Registra todas las decisiones en la bitácora de acciones con evidencia y razón en español.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-foreground flex items-center gap-1.5 mb-1">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Lo que Atenia AI NUNCA hace automáticamente
          </h4>
          <ul className="space-y-1 text-muted-foreground ml-4 list-disc">
            <li>No elimina datos de actuaciones, publicaciones ni procesos.</li>
            <li>No modifica radicados, etapas procesales ni información jurídica.</li>
            <li>No activa mappings de proveedores externos (requiere aprobación de admin).</li>
            <li>No crea ni modifica credenciales o instancias de proveedores.</li>
            <li>No ejecuta acciones durante la ventana del cron diario (6:50–7:30 AM COT).</li>
            <li>No ejecuta acciones destructivas basadas únicamente en sugerencias de LLM.</li>
            <li>No envía comunicaciones a usuarios finales ni tribunales.</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Todas las acciones autónomas son reversibles, están limitadas por frecuencia (máx. 5 por ciclo), y respetan la configuración de pausa de autonomía por organización.
        </p>
      </CardContent>
    </Card>
  );
}
