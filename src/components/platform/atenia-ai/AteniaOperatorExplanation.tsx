/**
 * AteniaOperatorExplanation — Operator explanation card in Spanish
 *
 * Describes what Atenia AI does automatically and what it will never do.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, ShieldCheck, Zap } from "lucide-react";

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
            <li>Continúa sincronización diaria cuando se agota presupuesto de tiempo (máx 3 continuaciones/día).</li>
            <li>Reintentos de fuentes huérfanas con errores transitorios (máx 30/día, respeta cooldowns por objetivo).</li>
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
            <li>No modifica código, migraciones, políticas RLS, ni configuración del sistema.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-foreground flex items-center gap-1.5 mb-1">
            <Zap className="h-4 w-4 text-primary" />
            Acciones que REQUIEREN CONFIRMACIÓN (propone, no ejecuta)
          </h4>
          <ul className="space-y-1 text-muted-foreground ml-4 list-disc">
            <li>Degradar ruta de proveedor por alta tasa de error (temporal, auto-expira en 2h).</li>
            <li>Reactivación masiva de monitoreo en lote.</li>
            <li>Escalada a modelo de lenguaje (Gemini) para diagnóstico avanzado.</li>
          </ul>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 space-y-2">
          <h4 className="font-semibold text-foreground flex items-center gap-1.5 text-xs">
            📊 Presupuestos actuales (configurables en panel de autonomía)
          </h4>
          <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
            <li><strong>Reintentos:</strong> máx. 10/hora, 30/día</li>
            <li><strong>Suspensiones:</strong> máx. 5/hora, 15/día</li>
            <li><strong>Continuaciones de sync:</strong> máx. 3/hora, 6/día</li>
            <li><strong>Degradación de proveedor:</strong> máx. 2/hora, 4/día (con confirmación)</li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Todas las acciones autónomas son reversibles, están limitadas por frecuencia, respetan la configuración de pausa de autonomía por organización, y dejan un rastro de auditoría completo con evidencia y razonamiento.
        </p>
      </CardContent>
    </Card>
  );
}
