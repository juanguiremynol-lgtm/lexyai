import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Mail, Shield, FileText, Database, Package, FileDown, Truck, Stamp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


const DIRECTORIO_RAMA_URL = "https://www.ramajudicial.gov.co/directorio-cuentas-de-correo-electronico";
const TUTELA_EN_LINEA_URL = "https://procesojudicial.ramajudicial.gov.co/TutelaEnLinea";
const DEMANDA_EN_LINEA_URL = "https://procesojudicial.ramajudicial.gov.co/demandaenlinea/";
const DATOS_ABIERTOS_URL = "https://www.datos.gov.co/browse?sortBy=newest&utf8=%E2%9C%93&pageSize=20";
const SERVIENTREGA_URL = "https://www.servientrega.com/wps/portal/soluciones-digitales/e-entrega";
const ILOVEPDF_URL = "https://www.ilovepdf.com/";
const ENVIAMOS_URL = "https://enviamoscym.com/";
const CERTIFICADOS_SNR_URL = "https://certificados.supernotariado.gov.co/certificado";
const RUES_URL = "https://www.rues.org.co/";
export default function Links() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Enlaces Útiles</h1>
        <p className="text-muted-foreground">Recursos y directorios externos.</p>
      </div>

      <Tabs defaultValue="correos-externo" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
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
          <TabsTrigger value="datos-abiertos" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Datos Abiertos
          </TabsTrigger>
          <TabsTrigger value="servientrega" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Servientrega e-Entrega
          </TabsTrigger>
          <TabsTrigger value="ilovepdf" className="flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            iLovePDF
          </TabsTrigger>
          <TabsTrigger value="enviamos" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Enviamos CyM
          </TabsTrigger>
          <TabsTrigger value="certificados-snr" className="flex items-center gap-2">
            <Stamp className="h-4 w-4" />
            Certificados SNR
          </TabsTrigger>
          <TabsTrigger value="rues" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            RUES
          </TabsTrigger>
        </TabsList>

        <TabsContent value="correos-externo" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Directorio Oficial — Rama Judicial</CardTitle>
                  <CardDescription className="mt-1">
                    Directorio de cuentas de correo electrónico publicado por la Rama Judicial de Colombia (Power BI)
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Consulte el directorio oficial de correos electrónicos de los despachos judiciales del país, publicado y mantenido por la Rama Judicial. El recurso se abre en una nueva pestaña en el sitio oficial.
              </p>
              <Button asChild>
                <a
                  href={DIRECTORIO_RAMA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Directorio Oficial
                </a>
              </Button>
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

        <TabsContent value="datos-abiertos" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Database className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Datos Abiertos Colombia</CardTitle>
                  <CardDescription className="mt-1">
                    Portal oficial de datos abiertos del gobierno colombiano
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Acceda al catálogo de datos abiertos publicados por entidades del gobierno de Colombia, incluyendo datasets de salud, educación, justicia y más.
              </p>
              <Button asChild>
                <a
                  href={DATOS_ABIERTOS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Portal de Datos Abiertos
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="servientrega" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Servientrega e-Entrega</CardTitle>
                  <CardDescription className="mt-1">
                    Plataforma digital de Servientrega para gestión de entregas y notificaciones electrónicas
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Acceda al portal de soluciones digitales de Servientrega para la gestión de entregas electrónicas, útil para notificaciones judiciales y envío de documentos legales.
              </p>
              <Button asChild>
                <a
                  href={SERVIENTREGA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Servientrega e-Entrega
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ilovepdf" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <FileDown className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">iLovePDF</CardTitle>
                  <CardDescription className="mt-1">
                    Herramientas en línea para trabajar con archivos PDF
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Comprima, convierta, combine, divida y edite archivos PDF de forma gratuita. Útil para preparar documentos judiciales, reducir tamaño de anexos y convertir formatos.
              </p>
              <Button asChild>
                <a
                  href={ILOVEPDF_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir iLovePDF
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enviamos" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Truck className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Enviamos CyM</CardTitle>
                  <CardDescription className="mt-1">
                    Servicio de mensajería y envíos para documentos legales
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Plataforma de mensajería especializada para el envío de documentos, notificaciones judiciales y correspondencia legal a nivel nacional.
              </p>
              <Button asChild>
                <a
                  href={ENVIAMOS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Enviamos CyM
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certificados-snr" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Stamp className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Certificados de Tradición y Libertad</CardTitle>
                  <CardDescription className="mt-1">
                    Superintendencia de Notariado y Registro — Consulta y solicitud de certificados
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Portal oficial de la Superintendencia de Notariado y Registro para solicitar certificados de tradición y libertad de bienes inmuebles en Colombia.
              </p>
              <Button asChild>
                <a
                  href={CERTIFICADOS_SNR_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Portal de Certificados
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rues" className="mt-6">
          <Card className="max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-primary/10">
                  <Search className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">RUES — Registro Único Empresarial y Social</CardTitle>
                  <CardDescription className="mt-1">
                    Consulta de empresas, establecimientos y entidades sin ánimo de lucro registradas en Colombia
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Portal oficial del Registro Único Empresarial y Social para consultar información de personas jurídicas, establecimientos de comercio, NIT, representantes legales y más.
              </p>
              <Button asChild>
                <a
                  href={RUES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir RUES
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}