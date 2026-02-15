/**
 * Colombia Judicial Section — Badges + Security info for landing page
 */

import { Badge } from "@/components/ui/badge";
import { Shield, Lock, KeyRound, Eye, Server, Landmark, Scale, FileCheck } from "lucide-react";

const JUDICIAL_BADGES = [
  {
    name: "Rama Judicial",
    description: "Integración directa con los sistemas de la Rama Judicial de Colombia (SAMAI, CPNU, Consulta Unificada).",
    icon: Landmark,
  },
  {
    name: "Consejo Superior de la Judicatura",
    description: "Datos procesales verificados contra las fuentes oficiales del CSJ para máxima confiabilidad.",
    icon: Scale,
  },
  {
    name: "Calendario Judicial CO",
    description: "Cálculo de términos con días hábiles, festivos nacionales y calendarios judiciales colombianos.",
    icon: FileCheck,
  },
];

const SECURITY_FEATURES = [
  {
    icon: Lock,
    title: "Cifrado AES-256-GCM",
    description: "Toda la información sensible se cifra con AES-256-GCM en reposo y en tránsito. Claves rotadas automáticamente.",
  },
  {
    icon: Shield,
    title: "Aislamiento Multi-Tenant",
    description: "Cada firma tiene su espacio aislado. Las políticas RLS garantizan que ningún dato cruza fronteras de organización.",
  },
  {
    icon: Eye,
    title: "Privacidad por Defecto",
    description: "Cero recolección de datos personales para entrenamiento de IA. Sin acceso administrativo a documentos de clientes.",
  },
  {
    icon: KeyRound,
    title: "Acceso Temporal Auditado",
    description: "El soporte técnico requiere autorización explícita del usuario, con duración máxima de 30 minutos y auditoría completa.",
  },
  {
    icon: Server,
    title: "Proxy de Egreso Seguro",
    description: "Todo tráfico saliente pasa por un proxy con escaneo de PII y listas de destinos permitidos. Sin exfiltración posible.",
  },
];

export function ColombiaJudicialSection() {
  return (
    <section className="py-20 md:py-28 bg-muted/30" id="colombia">
      <div className="container max-w-7xl mx-auto px-4">
        {/* Colombia Badges */}
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <Badge variant="outline" className="mb-4">
            <Landmark className="h-3.5 w-3.5 mr-1.5" />
            Hecho para Colombia
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Diseñado exclusivamente para el litigio colombiano
          </h2>
          <p className="text-muted-foreground text-lg">
            Andromeda se conecta directamente a las fuentes oficiales de la justicia colombiana. 
            No es una herramienta genérica adaptada — está construida desde cero para la práctica jurídica nacional.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-6 mb-20">
          {JUDICIAL_BADGES.map((b) => {
            const Icon = b.icon;
            return (
              <div
                key={b.name}
                className="flex flex-col items-center text-center p-6 rounded-xl border bg-card/60"
              >
                <div className="p-3 rounded-xl bg-primary/10 mb-4">
                  <Icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{b.name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{b.description}</p>
              </div>
            );
          })}
        </div>

        {/* Security & Encryption */}
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <Badge variant="outline" className="mb-4">
            <Shield className="h-3.5 w-3.5 mr-1.5" />
            Seguridad & Privacidad
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Tu información está blindada
          </h2>
          <p className="text-muted-foreground text-lg">
            Cifrado de grado militar, aislamiento total entre organizaciones, y una política 
            estricta de cero acceso a datos de clientes. Tu información nunca se usa para entrenar modelos de IA.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECURITY_FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="flex items-start gap-4 p-5 rounded-xl border bg-card/60"
              >
                <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-1">{f.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust footer */}
        <div className="mt-10 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground border rounded-full px-4 py-2">
            <Lock className="h-4 w-4" />
            100% de campos PII cifrados · RLS org-scoped · Auditoría inmutable · Sin recolección de datos
          </div>
        </div>
      </div>
    </section>
  );
}
