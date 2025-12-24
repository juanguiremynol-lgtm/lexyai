import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Search, 
  Mail, 
  Copy, 
  Check, 
  Building2, 
  MapPin,
  Scale,
  ExternalLink
} from "lucide-react";
import { toast } from "sonner";
import {
  searchCourts,
  findCourtEmail,
  generateCourtEmail,
  getAvailableCities,
  getAvailableSpecialties,
  filterCourts,
  type CourtEmail,
} from "@/lib/court-emails-directory";

export function CourtEmailLookup() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>("");
  const [manualDespacho, setManualDespacho] = useState("");
  const [manualCiudad, setManualCiudad] = useState("");
  const [generatedEmail, setGeneratedEmail] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const cities = useMemo(() => getAvailableCities(), []);
  const specialties = useMemo(() => getAvailableSpecialties(), []);

  const searchResults = useMemo(() => {
    if (searchQuery.length >= 2) {
      return searchCourts(searchQuery, 50);
    }
    if (selectedCity || selectedSpecialty) {
      return filterCourts({
        ciudad: selectedCity || undefined,
        especialidad: selectedSpecialty || undefined,
        limit: 50,
      });
    }
    return [];
  }, [searchQuery, selectedCity, selectedSpecialty]);

  const handleCopyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      toast.success("Correo copiado al portapapeles");
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch {
      toast.error("No se pudo copiar el correo");
    }
  };

  const handleGenerateEmail = () => {
    if (!manualDespacho || !manualCiudad) {
      toast.error("Ingrese el nombre del despacho y la ciudad");
      return;
    }
    const email = generateCourtEmail(manualDespacho, manualCiudad);
    if (email) {
      setGeneratedEmail(email);
      toast.success("Correo generado exitosamente");
    } else {
      toast.error("No se pudo generar el correo. Verifique los datos ingresados.");
    }
  };

  const handleFindEmail = () => {
    if (!manualDespacho) {
      toast.error("Ingrese el nombre del despacho");
      return;
    }
    const email = findCourtEmail(manualDespacho, manualCiudad || undefined);
    if (email) {
      setGeneratedEmail(email);
      toast.success("Correo encontrado");
    } else {
      toast.error("No se encontró el correo para este despacho");
    }
  };

  return (
    <div className="space-y-6">
      {/* Search and Filter Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Buscar en Directorio
          </CardTitle>
          <CardDescription>
            Busque despachos judiciales por nombre, ciudad o especialidad
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search">Búsqueda</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Ej: Juzgado 15 Civil, Medellín, Familia..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ciudad</Label>
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las ciudades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas las ciudades</SelectItem>
                  {cities.map((city) => (
                    <SelectItem key={city} value={city}>
                      {city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Especialidad</Label>
              <Select value={selectedSpecialty} onValueChange={setSelectedSpecialty}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas las especialidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas las especialidades</SelectItem>
                  {specialties.map((specialty) => (
                    <SelectItem key={specialty} value={specialty}>
                      {specialty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Results */}
          {searchResults.length > 0 && (
            <div className="mt-4">
              <Label className="mb-2 block">
                Resultados ({searchResults.length})
              </Label>
              <ScrollArea className="h-[300px] border rounded-md">
                <div className="p-2 space-y-2">
                  {searchResults.map((court, index) => (
                    <CourtResultCard
                      key={`${court.email}-${index}`}
                      court={court}
                      onCopy={handleCopyEmail}
                      isCopied={copiedEmail === court.email}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Building2 className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2">No se encontraron resultados</p>
              <p className="text-sm">Intente con otro término de búsqueda</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Generation Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Generar Correo Manualmente
          </CardTitle>
          <CardDescription>
            Si no encuentra el despacho en el directorio, genere el correo a partir del nombre
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="manual-despacho">Nombre del Despacho</Label>
              <Input
                id="manual-despacho"
                placeholder="Ej: Juzgado 15 Civil del Circuito"
                value={manualDespacho}
                onChange={(e) => setManualDespacho(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-ciudad">Ciudad</Label>
              <Input
                id="manual-ciudad"
                placeholder="Ej: Bogotá"
                value={manualCiudad}
                onChange={(e) => setManualCiudad(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleFindEmail} variant="outline">
              <Search className="h-4 w-4 mr-2" />
              Buscar en Directorio
            </Button>
            <Button onClick={handleGenerateEmail}>
              <Mail className="h-4 w-4 mr-2" />
              Generar Correo
            </Button>
          </div>

          {generatedEmail && (
            <div className="p-4 bg-muted rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                <span className="font-mono text-sm">{generatedEmail}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopyEmail(generatedEmail)}
              >
                {copiedEmail === generatedEmail ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            Directorio Oficial
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Este directorio se basa en los patrones de correo electrónico oficiales de la Rama Judicial.
            Para consultar el directorio oficial completo, visite:
          </p>
          <a
            href="https://www.ramajudicial.gov.co/directorio-cuentas-de-correo-electronico"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Rama Judicial - Directorio de Correos Electrónicos
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function CourtResultCard({
  court,
  onCopy,
  isCopied,
}: {
  court: CourtEmail;
  onCopy: (email: string) => void;
  isCopied: boolean;
}) {
  return (
    <div className="p-3 bg-card border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{court.despacho}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              <MapPin className="h-3 w-3 mr-1" />
              {court.ciudad}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              <Scale className="h-3 w-3 mr-1" />
              {court.especialidad}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {court.email}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={() => onCopy(court.email)}
        >
          {isCopied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
