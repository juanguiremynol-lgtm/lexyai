import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadicadoConstructor, TerminosCalculator, SnakeGame } from "@/components/utilities";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Calculator, 
  ExternalLink, 
  Briefcase, 
  Scale, 
  FileText, 
  Shield, 
  Clock, 
  Gavel, 
  FileCheck,
  Building2,
  Bell,
  FileSignature,
  ScrollText,
  Wrench,
  CalendarDays,
  Gamepad2
} from "lucide-react";

const EXTERNAL_TOOLS = [
  {
    title: "Liquidador de Obligaciones",
    description: "Calculadora de intereses remuneratorios y moratorios",
    url: "https://colombia-legal-rates.lovable.app/liquidador",
    icon: Calculator,
  },
  {
    title: "Liquidación Laboral",
    description: "Cálculo de prestaciones sociales y beneficios laborales",
    url: "https://colombia-legal-rates.lovable.app/labor",
    icon: Briefcase,
  },
  {
    title: "El Árbol Lógico",
    description: "Competencia según el Código General del Proceso",
    url: "https://colombia-legal-rates.lovable.app/cgp",
    icon: Scale,
  },
  {
    title: "Derecho de Petición",
    description: "Generador automático de documentos de petición",
    url: "https://colombia-legal-rates.lovable.app/derecho-peticion",
    icon: FileText,
  },
  {
    title: "Acción de Tutela",
    description: "Generador de tutelas por vulneración del derecho de petición",
    url: "https://colombia-legal-rates.lovable.app/tutela",
    icon: Shield,
  },
  {
    title: "Prescripción y Caducidad",
    description: "Cálculo de términos civiles, laborales y contencioso-administrativos",
    url: "https://colombia-legal-rates.lovable.app/prescripcion",
    icon: Clock,
  },
  {
    title: "Demanda Ejecutiva",
    description: "Generador de demandas ejecutivas por factura y P.H.",
    url: "https://colombia-legal-rates.lovable.app/demanda-ejecutiva",
    icon: Gavel,
  },
  {
    title: "Demanda Monitoria",
    description: "Proceso monitorio para cobro de deudas (CGP arts. 419-421)",
    url: "https://colombia-legal-rates.lovable.app/demanda-monitoria",
    icon: FileCheck,
  },
  {
    title: "Procesos Verbales Policivos",
    description: "Gestión integral de querellas, audiencias y plazos (Ley 1801/2016)",
    url: "https://colombia-legal-rates.lovable.app/procesos-verbales",
    icon: Building2,
  },
  {
    title: "Notificaciones CGP + Justicia Digital",
    description: "Notificaciones judiciales CGP arts. 291-296 y Ley 2213/2022",
    url: "https://colombia-legal-rates.lovable.app/notificaciones-cgp",
    icon: Bell,
  },
  {
    title: "Poder Especial",
    description: "Generador de poderes especiales judiciales y administrativos",
    url: "https://colombia-legal-rates.lovable.app/poder-especial",
    icon: FileSignature,
  },
  {
    title: "Contrato de Servicios",
    description: "Generador de contratos de prestación de servicios profesionales",
    url: "https://colombia-legal-rates.lovable.app/contrato-servicios",
    icon: ScrollText,
  },
];

export default function Utilities() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Utilidades</h1>
        <p className="text-muted-foreground">Herramientas para el ejercicio profesional.</p>
      </div>

      <Tabs defaultValue="terminos" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="terminos" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Calculadora de Términos
          </TabsTrigger>
          <TabsTrigger value="externas" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Herramientas Externas
          </TabsTrigger>
          <TabsTrigger value="radicado" className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Constructor de Radicado
          </TabsTrigger>
          <TabsTrigger value="snake" className="flex items-center gap-2">
            <Gamepad2 className="h-4 w-4" />
            Recreo
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="terminos" className="mt-6">
          <TerminosCalculator />
        </TabsContent>
        
        <TabsContent value="externas" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXTERNAL_TOOLS.map((tool) => (
              <a
                key={tool.url}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
              >
                <Card className="h-full transition-all hover:shadow-md hover:border-primary/50 group-hover:bg-muted/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <tool.icon className="h-5 w-5" />
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <CardTitle className="text-base mt-3">{tool.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {tool.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="radicado" className="mt-6">
          <RadicadoConstructor />
        </TabsContent>

        <TabsContent value="snake" className="mt-6">
          <SnakeGame />
        </TabsContent>
      </Tabs>
    </div>
  );
}
