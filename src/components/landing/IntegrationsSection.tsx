import { Badge } from "@/components/ui/badge";
import { Database, Globe, Server, ArrowLeftRight } from "lucide-react";

const INTEGRATIONS = [
  {
    name: "SAMAI Estados",
    description: "Consulta de estados procesales de la Rama Judicial (CPACA)",
    type: "Estados",
  },
  {
    name: "CPNU",
    description: "Consulta Nacional Unificada de Procesos",
    type: "Actuaciones",
  },
  {
    name: "SAMAI",
    description: "Sistema de Gestión Judicial del CPACA",
    type: "Actuaciones",
  },
  {
    name: "Tutelas API",
    description: "API especializada para seguimiento de tutelas",
    type: "Tutelas",
  },
  {
    name: "Publicaciones Procesales",
    description: "Monitoreo de publicaciones de juzgados",
    type: "Publicaciones",
  },
  {
    name: "Días Hábiles CO",
    description: "Calendario judicial colombiano con festivos",
    type: "Términos",
  },
];

export function IntegrationsSection() {
  return (
    <section className="py-20 md:py-28" id="integrations">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <Badge variant="outline" className="mb-4">
            <Database className="h-3.5 w-3.5 mr-1.5" />
            Integraciones
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Conectado a las fuentes oficiales
          </h2>
          <p className="text-muted-foreground text-lg">
            Andromeda consulta múltiples APIs de la Rama Judicial colombiana con 
            fallback automático y reintentos inteligentes gestionados por Andro IA.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INTEGRATIONS.map((int) => (
            <div
              key={int.name}
              className="flex items-center gap-4 p-5 rounded-xl border bg-card/60 hover:bg-card transition-colors"
            >
              <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h4 className="font-semibold text-sm">{int.name}</h4>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {int.type}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{int.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground border rounded-full px-4 py-2">
            <ArrowLeftRight className="h-4 w-4" />
            Fallback automático entre proveedores · Reintentos inteligentes · Auto-remediación
          </div>
        </div>
      </div>
    </section>
  );
}
