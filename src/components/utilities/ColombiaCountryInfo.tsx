import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Flag } from "lucide-react";
import { fetchApiColombia } from "@/lib/api-colombia";

interface CountryColombia {
  id: number;
  name: string;
  description: string;
  stateCapital: string;
  surface: number;
  population: number;
  languages: string[];
  timeZone: string;
  currency: string;
  currencyCode: string;
  currencySymbol: string;
  iSOCode: string;
  internetDomain: string;
  phonePrefix: string;
  radioPrefix: string;
  aircraftPrefix: string;
  subRegion: string;
  region: string;
  borders: string[];
  flags: string[];
}

async function fetchCountry(): Promise<CountryColombia> {
  return fetchApiColombia<CountryColombia>("/api/v1/CountryColombia");
}

export function ColombiaCountryInfo() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["colombia-country"],
    queryFn: fetchCountry,
    staleTime: 1000 * 60 * 60,
  });

  const fmt = (n: number) => n?.toLocaleString("es-CO") ?? "—";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Cargando información…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-destructive text-sm">
          Error al cargar la información. Intenta de nuevo más tarde.
        </CardContent>
      </Card>
    );
  }

  const sections = [
    {
      title: "Información General",
      items: [
        { label: "Capital", value: data.stateCapital },
        { label: "Población", value: fmt(data.population) },
        { label: "Superficie", value: `${fmt(data.surface)} km²` },
        { label: "Región", value: data.region },
        { label: "Subregión", value: data.subRegion },
        { label: "Código ISO", value: data.iSOCode },
      ],
    },
    {
      title: "Comunicaciones",
      items: [
        { label: "Prefijo telefónico", value: data.phonePrefix },
        { label: "Dominio internet", value: data.internetDomain },
        { label: "Prefijo radio", value: data.radioPrefix },
        { label: "Prefijo aeronaves", value: data.aircraftPrefix },
        { label: "Zona horaria", value: data.timeZone },
      ],
    },
    {
      title: "Moneda",
      items: [
        { label: "Moneda", value: data.currency },
        { label: "Código", value: data.currencyCode },
        { label: "Símbolo", value: data.currencySymbol },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            {data.flags?.[0] && (
              <img src={data.flags[0]} alt="Bandera de Colombia" className="h-8 rounded shadow-sm" />
            )}
            <div>
              <CardTitle className="text-lg">{data.name}</CardTitle>
              <CardDescription>Fuente: api-colombia.com</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">{data.description}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {section.items.map((item) => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium text-right">{item.value || "—"}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.languages?.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">Idiomas</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-wrap gap-1.5">
              {data.languages.map((lang) => (
                <Badge key={lang} variant="secondary" className="text-xs">{lang}</Badge>
              ))}
            </CardContent>
          </Card>
        )}
        {data.borders?.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">Fronteras</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-wrap gap-1.5">
              {data.borders.map((border) => (
                <Badge key={border} variant="outline" className="text-xs">{border}</Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
