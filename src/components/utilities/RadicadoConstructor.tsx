import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { 
  Copy, 
  RotateCcw, 
  Save, 
  Trash2, 
  ChevronDown,
  CheckCircle,
  AlertCircle,
  Info
} from "lucide-react";
import { 
  DIVIPOLA, 
  CORP_OPTIONS, 
  SPEC_OPTIONS, 
  formatRadicado, 
  onlyDigits, 
  padLeft, 
  normalizeCode 
} from "@/lib/divipola-data";

interface Preset {
  name: string;
  dane5: string;
  corp: string;
  spec: string;
  officeNo: string;
}

const PRESET_KEY = "lexetlit_radicado_presets_v1";

export function RadicadoConstructor() {
  // Builder state
  const [selectedDept, setSelectedDept] = useState("05");
  const [selectedMun, setSelectedMun] = useState("05001");
  const [globalSearch, setGlobalSearch] = useState("");
  const [corp, setCorp] = useState("40");
  const [customCorp, setCustomCorp] = useState("");
  const [spec, setSpec] = useState("89");
  const [customSpec, setCustomSpec] = useState("");
  const [officeNo, setOfficeNo] = useState("001");
  const [isCollegiate, setIsCollegiate] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [seq, setSeq] = useState("00001");
  const [appeal, setAppeal] = useState("00");
  const [tail, setTail] = useState("");

  // Parser state
  const [parseInput, setParseInput] = useState("");
  const [parsedResult, setParsedResult] = useState<{
    digits: string;
    dane5: string;
    corp: string;
    spec: string;
    officeNo: string;
    year: string;
    seq: string;
    appeal: string;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Presets state
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  // Load presets on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setPresets(arr);
      }
    } catch {}
  }, []);

  // Calculated DANE code
  const dane5 = useMemo(() => {
    return normalizeCode(selectedMun, 5);
  }, [selectedMun]);

  // Get municipalities for selected department
  const municipalities = useMemo(() => {
    return DIVIPOLA[selectedDept]?.municipios || [];
  }, [selectedDept]);

  // Global search data
  const allMunicipalities = useMemo(() => {
    const result: { codigo: string; nombre: string; dept: string; deptNombre: string }[] = [];
    Object.entries(DIVIPOLA).forEach(([deptCode, dept]) => {
      dept.municipios.forEach((mun) => {
        result.push({
          codigo: mun.codigo,
          nombre: mun.nombre,
          dept: deptCode,
          deptNombre: dept.nombre,
        });
      });
    });
    return result;
  }, []);

  // Filter for global search
  const searchResults = useMemo(() => {
    if (!globalSearch || globalSearch.length < 2) return [];
    const search = globalSearch.toLowerCase();
    return allMunicipalities
      .filter((m) => 
        m.codigo.includes(search) || 
        m.nombre.toLowerCase().includes(search)
      )
      .slice(0, 10);
  }, [globalSearch, allMunicipalities]);

  // Parse tail (year + seq + appeal)
  const parseTail = (tailStr: string) => {
    const d = onlyDigits(tailStr);
    if (d.length < 4) return null;
    const yearPart = d.slice(0, 4);
    const rest = d.slice(4);

    if (rest.length === 7) {
      return { year: yearPart, seq: rest.slice(0, 5), appeal: rest.slice(5, 7) };
    }
    if (rest.length === 5) {
      return { year: yearPart, seq: rest.slice(0, 5), appeal: "00" };
    }
    if (rest.length >= 2) {
      const appealPart = rest.slice(-2);
      let seqPart = rest.slice(0, -2);
      if (seqPart.length > 0 && seqPart.length <= 5) {
        seqPart = padLeft(seqPart, 5);
        return { year: yearPart, seq: seqPart, appeal: appealPart };
      }
    }
    return null;
  };

  // Handle tail auto-fill
  useEffect(() => {
    if (tail) {
      const parsed = parseTail(tail);
      if (parsed) {
        setYear(parsed.year);
        setSeq(parsed.seq);
        setAppeal(parsed.appeal);
      }
    }
  }, [tail]);

  // Handle collegiate toggle
  useEffect(() => {
    if (isCollegiate) {
      setOfficeNo("000");
    }
  }, [isCollegiate]);

  // Build radicado
  const buildResult = useMemo(() => {
    const corpValue = corp === "__custom__" ? normalizeCode(customCorp, 2) : normalizeCode(corp, 2);
    const specValue = spec === "__custom__" ? normalizeCode(customSpec, 2) : normalizeCode(spec, 2);
    const officeValue = normalizeCode(officeNo, 3);
    const yearValue = normalizeCode(year, 4);
    const seqValue = padLeft(onlyDigits(seq), 5).slice(-5);
    const appealValue = padLeft(onlyDigits(appeal), 2).slice(-2);

    const errors: string[] = [];
    if (dane5.length !== 5) errors.push("Código DANE (5 dígitos) incompleto.");
    if (corpValue.length !== 2) errors.push("Código de corporación/juzgado (2 dígitos) incompleto.");
    if (specValue.length !== 2) errors.push("Código de especialidad (2 dígitos) incompleto.");
    if (officeValue.length !== 3) errors.push("Consecutivo del despacho (3 dígitos) incompleto.");
    if (yearValue.length !== 4) errors.push("Año (4 dígitos) incompleto.");
    if (seqValue.length !== 5) errors.push("Consecutivo (5 dígitos) incompleto.");
    if (appealValue.length !== 2) errors.push("Recurso (2 dígitos) incompleto.");

    if (errors.length) {
      return { valid: false, errors, digits: "", formatted: "" };
    }

    const digits23 = dane5 + corpValue + specValue + officeValue + yearValue + seqValue + appealValue;
    const formatted = formatRadicado(digits23);

    return {
      valid: true,
      errors: [],
      digits: digits23,
      formatted,
      breakdown: {
        dane5,
        corp: corpValue,
        spec: specValue,
        officeNo: officeValue,
        year: yearValue,
        seq: seqValue,
        appeal: appealValue,
      },
    };
  }, [dane5, corp, customCorp, spec, customSpec, officeNo, year, seq, appeal]);

  // Parse radicado
  const handleParse = () => {
    const digits = onlyDigits(parseInput);
    
    if (!digits) {
      setParsedResult(null);
      setParseError(null);
      return;
    }

    if (digits.length !== 23) {
      setParsedResult(null);
      setParseError(`Longitud inválida: ${digits.length} dígitos (deben ser 23)`);
      return;
    }

    const result = {
      digits,
      dane5: digits.slice(0, 5),
      corp: digits.slice(5, 7),
      spec: digits.slice(7, 9),
      officeNo: digits.slice(9, 12),
      year: digits.slice(12, 16),
      seq: digits.slice(16, 21),
      appeal: digits.slice(21, 23),
    };

    setParsedResult(result);
    setParseError(null);
  };

  // Load parsed to builder
  const loadParsedToBuilder = () => {
    if (!parsedResult) return;

    const deptCode = parsedResult.dane5.slice(0, 2);
    setSelectedDept(deptCode);
    
    // Wait for municipalities to load, then set municipality
    setTimeout(() => {
      setSelectedMun(parsedResult.dane5);
    }, 0);

    // Set corp - check if it's a known value
    const knownCorp = CORP_OPTIONS.find((o) => o.code === parsedResult.corp);
    if (knownCorp && knownCorp.code !== "__custom__") {
      setCorp(parsedResult.corp);
      setCustomCorp("");
    } else {
      setCorp("__custom__");
      setCustomCorp(parsedResult.corp);
    }

    // Set spec - check if it's a known value
    const knownSpec = SPEC_OPTIONS.find((o) => o.code === parsedResult.spec);
    if (knownSpec && knownSpec.code !== "__custom__") {
      setSpec(parsedResult.spec);
      setCustomSpec("");
    } else {
      setSpec("__custom__");
      setCustomSpec(parsedResult.spec);
    }

    setOfficeNo(parsedResult.officeNo);
    setIsCollegiate(parsedResult.officeNo === "000");
    setYear(parsedResult.year);
    setSeq(parsedResult.seq);
    setAppeal(parsedResult.appeal);

    toast.success("Radicado cargado en el constructor");
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string, label: string) => {
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado al portapapeles`);
    } catch {
      toast.error("Error al copiar");
    }
  };

  // Reset builder
  const resetBuilder = () => {
    setSelectedDept("05");
    setSelectedMun("05001");
    setGlobalSearch("");
    setCorp("40");
    setCustomCorp("");
    setSpec("89");
    setCustomSpec("");
    setOfficeNo("001");
    setIsCollegiate(false);
    setYear(new Date().getFullYear().toString());
    setSeq("00001");
    setAppeal("00");
    setTail("");
  };

  // Save preset
  const savePreset = () => {
    if (!buildResult.valid) {
      toast.error("Complete todos los campos antes de guardar el preset");
      return;
    }

    const name = prompt("Nombre del preset:", `${DIVIPOLA[selectedDept]?.municipios.find(m => m.codigo === selectedMun)?.nombre || dane5} — corp ${buildResult.breakdown?.corp} / esp ${buildResult.breakdown?.spec}`);
    if (!name) return;

    const newPreset: Preset = {
      name,
      dane5: buildResult.breakdown!.dane5,
      corp: buildResult.breakdown!.corp,
      spec: buildResult.breakdown!.spec,
      officeNo: buildResult.breakdown!.officeNo,
    };

    const updated = [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated));
    toast.success("Preset guardado");
  };

  // Apply preset
  const applyPreset = () => {
    const idx = parseInt(selectedPreset);
    if (isNaN(idx) || !presets[idx]) return;

    const p = presets[idx];
    const deptCode = p.dane5.slice(0, 2);
    setSelectedDept(deptCode);
    setTimeout(() => {
      setSelectedMun(p.dane5);
    }, 0);

    const knownCorp = CORP_OPTIONS.find((o) => o.code === p.corp);
    if (knownCorp && knownCorp.code !== "__custom__") {
      setCorp(p.corp);
      setCustomCorp("");
    } else {
      setCorp("__custom__");
      setCustomCorp(p.corp);
    }

    const knownSpec = SPEC_OPTIONS.find((o) => o.code === p.spec);
    if (knownSpec && knownSpec.code !== "__custom__") {
      setSpec(p.spec);
      setCustomSpec("");
    } else {
      setSpec("__custom__");
      setCustomSpec(p.spec);
    }

    setOfficeNo(p.officeNo);
    setIsCollegiate(p.officeNo === "000");

    toast.success("Preset aplicado");
  };

  // Delete preset
  const deletePreset = () => {
    const idx = parseInt(selectedPreset);
    if (isNaN(idx) || !presets[idx]) return;

    if (!confirm(`¿Eliminar el preset "${presets[idx].name}"?`)) return;

    const updated = presets.filter((_, i) => i !== idx);
    setPresets(updated);
    localStorage.setItem(PRESET_KEY, JSON.stringify(updated));
    setSelectedPreset("");
    toast.success("Preset eliminado");
  };

  // Get municipality info for parsed result
  const getParsedMunInfo = () => {
    if (!parsedResult) return null;
    const deptCode = parsedResult.dane5.slice(0, 2);
    const dept = DIVIPOLA[deptCode];
    if (!dept) return { deptName: "(desconocido)", munName: "(desconocido)" };
    
    const mun = dept.municipios.find((m) => m.codigo === parsedResult.dane5);
    return {
      deptName: dept.nombre,
      munName: mun?.nombre || "(desconocido)",
    };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left column - Builder */}
      <div className="lg:col-span-3 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">1) Constructor</span>
              <Badge variant="outline">Generar radicado completo</Badge>
            </CardTitle>
            <CardDescription>
              Construya el número único de radicación (23 dígitos) a partir de los componentes del despacho y proceso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Geographic section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Departamento (DIVIPOLA / DANE)</Label>
                <Select value={selectedDept} onValueChange={(v) => {
                  setSelectedDept(v);
                  setSelectedMun("");
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione departamento" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DIVIPOLA).sort().map(([code, dept]) => (
                      <SelectItem key={code} value={code}>
                        {code} — {dept.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Datos DIVIPOLA embebidos (DANE - Geoportal).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Municipio (DIVIPOLA / DANE)</Label>
                <Select value={selectedMun} onValueChange={setSelectedMun}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione municipio" />
                  </SelectTrigger>
                  <SelectContent>
                    {municipalities.map((mun) => (
                      <SelectItem key={mun.codigo} value={mun.codigo}>
                        {mun.codigo} — {mun.nombre} {mun.tipo ? `(${mun.tipo})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Código DANE del municipio sede del despacho.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Búsqueda global rápida</Label>
                <Input 
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  placeholder="Ej.: 05400, LA CEJA, BOGOTÁ..."
                />
                {searchResults.length > 0 && (
                  <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-auto bg-popover">
                    {searchResults.map((m) => (
                      <button
                        key={m.codigo}
                        className="w-full text-left px-2 py-1 hover:bg-accent rounded text-sm"
                        onClick={() => {
                          setSelectedDept(m.dept);
                          setTimeout(() => setSelectedMun(m.codigo), 0);
                          setGlobalSearch("");
                        }}
                      >
                        {m.codigo} — {m.nombre} ({m.deptNombre})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Código DANE (5 dígitos) — calculado</Label>
                <Input value={dane5} readOnly className="font-mono bg-muted" />
                <p className="text-xs text-muted-foreground">
                  Formato: 2 dígitos departamento + 3 dígitos municipio.
                </p>
              </div>
            </div>

            {/* Corporation / Specialty */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Código corporación / juzgado (2 dígitos)</Label>
                <Select value={corp} onValueChange={setCorp}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    {CORP_OPTIONS.map((opt) => (
                      <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {corp === "__custom__" && (
                  <Input 
                    value={customCorp}
                    onChange={(e) => setCustomCorp(e.target.value)}
                    placeholder="Ingrese código (2 dígitos)"
                    maxLength={2}
                    className="font-mono"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Código sala / especialidad (2 dígitos)</Label>
                <Select value={spec} onValueChange={setSpec}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPEC_OPTIONS.map((opt) => (
                      <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {spec === "__custom__" && (
                  <Input 
                    value={customSpec}
                    onChange={(e) => setCustomSpec(e.target.value)}
                    placeholder="Ingrese código (2 dígitos)"
                    maxLength={2}
                    className="font-mono"
                  />
                )}
              </div>
            </div>

            {/* Office number */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="space-y-2">
                <Label>Consecutivo del despacho (3 dígitos)</Label>
                <Input 
                  value={officeNo}
                  onChange={(e) => setOfficeNo(e.target.value)}
                  placeholder="001"
                  maxLength={3}
                  disabled={isCollegiate}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Para juzgados: normalmente coincide con el ordinal (Primero=001, etc.).
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="collegiate" 
                  checked={isCollegiate}
                  onCheckedChange={(checked) => setIsCollegiate(checked === true)}
                />
                <label htmlFor="collegiate" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Órgano colegiado (Tribunal/Alta Corte): usar consecutivo 000
                </label>
              </div>
            </div>

            {/* Process block */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Año (4 dígitos)</Label>
                <Input 
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2025"
                  maxLength={4}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label>Consecutivo anual de radicación (5 dígitos)</Label>
                <Input 
                  value={seq}
                  onChange={(e) => setSeq(e.target.value)}
                  placeholder="00325"
                  maxLength={5}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Consecutivo de recursos (2 dígitos)</Label>
                <Input 
                  value={appeal}
                  onChange={(e) => setAppeal(e.target.value)}
                  placeholder="00"
                  maxLength={2}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  En general: 00 si no se trata de un recurso.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Pegue el "final" que le envió el juzgado</Label>
                <Input 
                  value={tail}
                  onChange={(e) => setTail(e.target.value)}
                  placeholder="2025-00325-00 | 20250032500"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Opcional: se intentará separar automáticamente año, consecutivo y recurso.
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copyToClipboard(buildResult.digits, "Radicado")}>
                <Copy className="h-4 w-4 mr-2" />
                Copiar
              </Button>
              <Button variant="outline" onClick={() => copyToClipboard(buildResult.formatted, "Radicado formateado")}>
                <Copy className="h-4 w-4 mr-2" />
                Copiar (con guiones)
              </Button>
              <Button variant="outline" onClick={savePreset}>
                <Save className="h-4 w-4 mr-2" />
                Guardar preset
              </Button>
              <Button variant="destructive" onClick={resetBuilder}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Restablecer
              </Button>
            </div>

            {/* Output */}
            <div className="bg-muted/50 border border-dashed rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {buildResult.valid ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    OK — 23 dígitos
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Faltan datos
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-xs">
                  Formato: #####-##-##-###-####-#####-##
                </Badge>
              </div>

              <div className="font-mono text-xl break-all">
                {buildResult.valid ? buildResult.digits : "—"}
              </div>
              <div className="font-mono text-sm text-muted-foreground">
                {buildResult.valid ? buildResult.formatted : "—"}
              </div>

              {buildResult.errors.length > 0 && (
                <div className="text-sm text-destructive">
                  {buildResult.errors.join(" ")}
                </div>
              )}

              {buildResult.valid && buildResult.breakdown && (
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-sm text-primary hover:underline">
                    <ChevronDown className="h-4 w-4" />
                    Ver descomposición (bloques)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1 text-sm">
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">DANE (5)</span>
                      <span><code className="font-mono">{buildResult.breakdown.dane5}</code> — Municipio sede</span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">Corporación (2)</span>
                      <span><code className="font-mono">{buildResult.breakdown.corp}</code></span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">Especialidad (2)</span>
                      <span><code className="font-mono">{buildResult.breakdown.spec}</code></span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">Despacho (3)</span>
                      <span><code className="font-mono">{buildResult.breakdown.officeNo}</code></span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">Año (4)</span>
                      <span><code className="font-mono">{buildResult.breakdown.year}</code></span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
                      <span className="text-muted-foreground">Consecutivo (5)</span>
                      <span><code className="font-mono">{buildResult.breakdown.seq}</code></span>
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
                      <span className="text-muted-foreground">Recurso (2)</span>
                      <span><code className="font-mono">{buildResult.breakdown.appeal}</code></span>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right column - Parser, Presets, Info */}
      <div className="lg:col-span-2 space-y-6">
        {/* Parser */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2) Analizador</CardTitle>
            <CardDescription>
              Pegue un radicado completo para entenderlo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Pegue aquí un radicado (con o sin guiones)</Label>
              <Textarea 
                value={parseInput}
                onChange={(e) => setParseInput(e.target.value)}
                placeholder="Ej.: 05001408900120250032500&#10;Ej.: 05001-40-89-001-2025-00325-00"
                className="font-mono text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleParse}>Analizar</Button>
              <Button variant="outline" onClick={loadParsedToBuilder} disabled={!parsedResult}>
                Cargar en constructor
              </Button>
              <Button variant="ghost" onClick={() => { setParseInput(""); setParsedResult(null); setParseError(null); }}>
                Limpiar
              </Button>
            </div>

            <div className="bg-muted/50 border border-dashed rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                {parsedResult ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    OK — 23 dígitos
                  </Badge>
                ) : parseError ? (
                  <Badge variant="destructive">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Error
                  </Badge>
                ) : (
                  <Badge variant="secondary">Sin analizar</Badge>
                )}
              </div>

              {parseError && (
                <div className="text-sm text-destructive">{parseError}</div>
              )}

              {parsedResult && (
                <>
                  <div className="font-mono text-lg break-all">{parsedResult.digits}</div>
                  <div className="font-mono text-sm text-muted-foreground">
                    {formatRadicado(parsedResult.digits)}
                  </div>

                  <div className="space-y-1 text-sm">
                    {(() => {
                      const info = getParsedMunInfo();
                      return (
                        <>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">DANE</span>
                            <span><code className="font-mono">{parsedResult.dane5}</code> — {info?.munName}, {info?.deptName}</span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">Corporación</span>
                            <span><code className="font-mono">{parsedResult.corp}</code></span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">Especialidad</span>
                            <span><code className="font-mono">{parsedResult.spec}</code></span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">Despacho</span>
                            <span><code className="font-mono">{parsedResult.officeNo}</code></span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">Año</span>
                            <span><code className="font-mono">{parsedResult.year}</code></span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b">
                            <span className="text-muted-foreground">Consecutivo</span>
                            <span><code className="font-mono">{parsedResult.seq}</code></span>
                          </div>
                          <div className="grid grid-cols-[100px_1fr] gap-2 py-1">
                            <span className="text-muted-foreground">Recurso</span>
                            <span><code className="font-mono">{parsedResult.appeal}</code></span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Presets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">3) Presets</CardTitle>
            <CardDescription>
              Guarde combinaciones de despacho para construir radicados rápidamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Presets guardados</Label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="— Seleccione —" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p, idx) => (
                    <SelectItem key={idx} value={String(idx)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button onClick={applyPreset} disabled={!selectedPreset}>Aplicar</Button>
              <Button variant="destructive" onClick={deletePreset} disabled={!selectedPreset}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Se almacenan en localStorage del navegador (sólo en este equipo).
            </p>
          </CardContent>
        </Card>

        {/* Structure reminder */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-4 w-4" />
              4) Estructura del radicado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
              <span className="text-muted-foreground">Bloque geográfico (12)</span>
              <span className="font-mono">DANE(5) + CORP(2) + ESP(2) + DESP(3)</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
              <span className="text-muted-foreground">Bloque del proceso (11)</span>
              <span className="font-mono">AÑO(4) + CONSEC(5) + RECURSO(2)</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2 py-1 border-b">
              <span className="text-muted-foreground">Formato legible</span>
              <span className="font-mono">#####-##-##-###-####-#####-##</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
              <span className="text-muted-foreground">Validación básica</span>
              <span>Debe tener <span className="font-mono">23</span> dígitos exactos.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
