import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

const POWER_BI_EMBED_URL = "https://app.powerbi.com/view?r=eyJrIjoiMjllZTNjNGYtNjYzMi00ZjUzLTgyMGYtNzE0OWNlZjM0YTY2IiwidCI6IjYyMmNiYTk4LTgwZjgtNDFmMy04ZGY1LThlYjk5OTAxNTk4YiIsImMiOjR9";

export default function Links() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Enlaces Útiles</h1>
        <p className="text-muted-foreground">Recursos y directorios externos.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Directorio de Correos Judiciales</CardTitle>
                <CardDescription>
                  Directorio oficial de cuentas de correo electrónico de la Rama Judicial
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://www.ramajudicial.gov.co/directorio-cuentas-de-correo-electronico"
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
              title="Directorio de Correos Judiciales"
              src={POWER_BI_EMBED_URL}
              className="w-full h-full"
              frameBorder="0"
              allowFullScreen
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
