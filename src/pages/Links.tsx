import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Mail, Shield, FileText, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourthouseDirectorySearch } from "@/components/links/CourthouseDirectorySearch";

const POWER_BI_EMBED_URL = "https://app.powerbi.com/view?r=eyJrIjoiMjllZTNjNGYtNjYzMi00ZjUzLTgyMGYtNzE0OWNlZjM0YTY2IiwidCI6IjYyMmNiYTk4LTgwZjgtNDFmMy04ZGY1LThlYjk5OTAxNTk4YiIsImMiOjR9";
const DIRECTORIO_RAMA_URL = "https://www.ramajudicial.gov.co/directorio-cuentas-de-correo-electronico";
const TUTELA_EN_LINEA_URL = "https://procesojudicial.ramajudicial.gov.co/TutelaEnLinea";
const DEMANDA_EN_LINEA_URL = "https://procesojudicial.ramajudicial.gov.co/demandaenlinea/";

export default function Links() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Enlaces Útiles</h1>
        <p className="text-muted-foreground">Recursos y directorios externos.</p>
      </div>

      <Tabs defaultValue="correos" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="correos" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Directorio de Correos
          </TabsTrigger>
          <TabsTrigger value="correos-externo" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Directorio Rama Judicial
          </TabsTrigger>
          <TabsTrigger value="tutela" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Tutela en Línea
          </TabsTrigger>
          <TabsTrigger value="demanda" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Demanda en Línea
          </TabsTrigger>
        </TabsList>

        <TabsContent value="correos" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Database className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Directorio de Correos Judiciales</CardTitle>
                    <CardDescription>
                      Busque el correo electrónico de cualquier despacho judicial de Colombia
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <CourthouseDirectorySearch />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="correos-externo" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Directorio Oficial — Rama Judicial</CardTitle>
                    <CardDescription>
                      Directorio de cuentas de correo electrónico publicado por la Rama Judicial (Power BI)
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={DIRECTORIO_RAMA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir en nueva pestaña
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="w-full h-[700px] border-t">
                <iframe
                  title="Directorio de Correos Judiciales — Rama Judicial"
                  src={POWER_BI_EMBED_URL}
                  className="w-full h-full"
                  frameBorder="0"
                  allowFullScreen
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tutela" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Shield className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Recepción de Tutela y Habeas Corpus en Línea</CardTitle>
                  <CardDescription className="mt-1">
                    Portal oficial de la Rama Judicial para radicar tutelas y habeas corpus electrónicamente
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                A través de este portal puede registrar una Acción de Tutela a nivel nacional, dentro del horario establecido por el Consejo Seccional de la Judicatura en cada región. Adicionalmente puede registrar Habeas Corpus durante las 24 horas del día.
              </p>
              <Button asChild>
                <a
                  href={TUTELA_EN_LINEA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Portal de Tutelas
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="demanda" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <FileText className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Recepción de Demandas en Línea</CardTitle>
                  <CardDescription className="mt-1">
                    Portal oficial de la Rama Judicial para radicar demandas electrónicamente
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Sistema para la recepción electrónica de demandas en las diferentes especialidades judiciales (civil, familia, laboral, etc.) a nivel nacional.
              </p>
              <Button asChild>
                <a
                  href={DEMANDA_EN_LINEA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Portal de Demandas
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
