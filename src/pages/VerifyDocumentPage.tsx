/**
 * Public Document & Evidence Pack Verification Page
 * Supports:
 *   1. Single PDF hash verification (existing)
 *   2. Evidence Pack ZIP verification (new): validates all hashes + event chain integrity
 * No auth required — designed for court submissions.
 */

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, CheckCircle2, XCircle, Loader2, Search, Upload,
  FileText, Lock, Package, AlertCircle,
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function computeBufferHash(buffer: ArrayBuffer): Promise<string> {
  // @ts-ignore — crypto.subtle.digest returns ArrayBuffer-compatible
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

async function computeStringHash(str: string): Promise<string> {
  return computeBufferHash(new TextEncoder().encode(str).buffer as ArrayBuffer);
}

async function computeFileHash(file: File): Promise<string> {
  return computeBufferHash(await file.arrayBuffer());
}

/** Recursive canonical JSON — must match server-side implementation */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

interface VerificationResult {
  step: string;
  status: "pass" | "fail" | "warn" | "info";
  detail: string;
}

interface ZipVerifyResult {
  overall: "valid" | "invalid" | "partial";
  results: VerificationResult[];
  manifest?: Record<string, unknown>;
}

async function verifyEvidencePack(file: File): Promise<ZipVerifyResult> {
  const JSZip = (await import("jszip")).default;
  const results: VerificationResult[] = [];

  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return {
      overall: "invalid",
      results: [{ step: "ZIP", status: "fail", detail: "El archivo no es un ZIP válido." }],
    };
  }

  // 1. Check manifest exists
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return {
      overall: "invalid",
      results: [{ step: "Manifest", status: "fail", detail: "manifest.json no encontrado en el ZIP." }],
    };
  }

  let manifest: Record<string, unknown>;
  try {
    const manifestText = await manifestFile.async("string");
    manifest = JSON.parse(manifestText);
    results.push({ step: "Manifest", status: "pass", detail: "manifest.json parseado correctamente." });
  } catch {
    return {
      overall: "invalid",
      results: [{ step: "Manifest", status: "fail", detail: "manifest.json no es un JSON válido." }],
    };
  }

  // 2. Verify events JSONL hash
  const eventsFile = zip.file("raw_events.jsonl");
  if (eventsFile) {
    const eventsContent = await eventsFile.async("string");
    const eventsHash = await computeStringHash(eventsContent);
    const expectedHash = (manifest as any)?.audit_chain?.events_jsonl_sha256;

    if (expectedHash) {
      if (eventsHash === expectedHash) {
        results.push({
          step: "Events JSONL",
          status: "pass",
          detail: `Hash SHA-256 coincide: ${eventsHash.substring(0, 16)}...`,
        });
      } else {
        results.push({
          step: "Events JSONL",
          status: "fail",
          detail: `Hash no coincide. Esperado: ${expectedHash.substring(0, 16)}..., Obtenido: ${eventsHash.substring(0, 16)}...`,
        });
      }
    }

    // 3. Verify hash chain
    const lines = eventsContent.trim().split("\n").filter(Boolean);
    let chainValid = true;
    let chainErrorDetail = "";

    for (let i = 0; i < lines.length; i++) {
      try {
        const event = JSON.parse(lines[i]);
        if (i === 0) {
          if (event.previous_event_hash !== null) {
            chainValid = false;
            chainErrorDetail = `Evento 0: previous_hash debería ser null.`;
          }
        } else {
          const prevEvent = JSON.parse(lines[i - 1]);
          if (event.previous_event_hash !== prevEvent.event_hash) {
            chainValid = false;
            chainErrorDetail = `Evento ${i}: previous_hash no coincide con event_hash del evento ${i - 1}.`;
          }
        }
      } catch {
        chainValid = false;
        chainErrorDetail = `Evento ${i}: JSON inválido.`;
      }
    }

    results.push({
      step: "Cadena de Hashes",
      status: chainValid ? "pass" : "fail",
      detail: chainValid
        ? `Cadena de ${lines.length} eventos verificada correctamente.`
        : chainErrorDetail,
    });

    // Check chain head matches manifest
    if (lines.length > 0 && chainValid) {
      try {
        const lastEvent = JSON.parse(lines[lines.length - 1]);
        const manifestHead = (manifest as any)?.audit_chain?.chain_head_hash;
        if (manifestHead && lastEvent.event_hash === manifestHead) {
          results.push({
            step: "Chain Head",
            status: "pass",
            detail: `Hash cabeza de cadena verificado: ${manifestHead.substring(0, 16)}...`,
          });
        } else if (manifestHead) {
          results.push({
            step: "Chain Head",
            status: "fail",
            detail: `Hash cabeza no coincide.`,
          });
        }
      } catch {
        // skip
      }
    }
  } else {
    results.push({
      step: "Events JSONL",
      status: "warn",
      detail: "raw_events.jsonl no encontrado en el ZIP.",
    });
  }

  // 4. Verify signed PDF hashes if present
  const pdfFiles = Object.keys(zip.files).filter(f => f.endsWith(".pdf"));
  const expectedPdfHash = (manifest as any)?.document?.final_pdf_sha256;

  if (expectedPdfHash && pdfFiles.length > 0) {
    let pdfVerified = false;
    for (const pdfName of pdfFiles) {
      const pdfData = await zip.file(pdfName)?.async("arraybuffer");
      if (pdfData) {
        const pdfHash = await computeBufferHash(pdfData);
        if (pdfHash === expectedPdfHash) {
          results.push({
            step: `PDF: ${pdfName}`,
            status: "pass",
            detail: `Hash SHA-256 coincide con final_pdf_sha256 del manifiesto.`,
          });
          pdfVerified = true;
          break;
        }
      }
    }
    if (!pdfVerified) {
      results.push({
        step: "PDF Hash",
        status: "warn",
        detail: "Ningún PDF en el ZIP coincide con el final_pdf_sha256 del manifiesto.",
      });
    }
  }

  // 5. Verify external proofs
  const externalProofs = (manifest as any)?.external_proofs || [];
  if (externalProofs.length > 0) {
    results.push({
      step: "Pruebas Externas",
      status: "info",
      detail: `${externalProofs.length} prueba(s) de entrega externa registrada(s) en el manifiesto.`,
    });
  }

  // 6. Document info
  const docInfo = (manifest as any)?.document;
  if (docInfo) {
    results.push({
      step: "Documento",
      status: "info",
      detail: `${docInfo.title || "Sin título"} — Tipo: ${docInfo.type || "N/A"} — Estado: ${docInfo.status || "N/A"}`,
    });
  }

  // 7. Signatures info
  const sigs = (manifest as any)?.signatures || [];
  if (sigs.length > 0) {
    for (const sig of sigs) {
      results.push({
        step: `Firmante: ${sig.signer_name}`,
        status: sig.status === "signed" ? "pass" : "info",
        detail: `Rol: ${sig.role} — Estado: ${sig.status}${sig.signed_at ? ` — Firmado: ${new Date(sig.signed_at).toLocaleDateString("es-CO")}` : ""}`,
      });
    }
  }

  const hasFail = results.some(r => r.status === "fail");
  return {
    overall: hasFail ? "invalid" : "valid",
    results,
    manifest,
  };
}

export default function VerifyDocumentPage() {
  const [hashInput, setHashInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [computingHash, setComputingHash] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ZIP verification state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipVerifying, setZipVerifying] = useState(false);
  const [zipResult, setZipResult] = useState<ZipVerifyResult | null>(null);
  const [zipDragOver, setZipDragOver] = useState(false);

  const handleVerify = async (hash?: string) => {
    const hashToVerify = hash || hashInput.trim();
    if (!hashToVerify) return;
    setVerifying(true);
    setResult(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ document_hash: hashToVerify.toLowerCase() }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ verified: false, message: "Error de conexión. Intente nuevamente." });
    } finally {
      setVerifying(false);
    }
  };

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setResult({ verified: false, message: "Solo se aceptan archivos PDF." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setResult({ verified: false, message: "El archivo excede el tamaño máximo de 10MB." });
      return;
    }
    setUploadedFile(file);
    setComputingHash(true);
    setResult(null);
    try {
      const hash = await computeFileHash(file);
      setHashInput(hash);
      setComputingHash(false);
      await handleVerify(hash);
    } catch {
      setComputingHash(false);
      setResult({ verified: false, message: "Error al procesar el archivo." });
    }
  }, []);

  const handleZipUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setZipResult({
        overall: "invalid",
        results: [{ step: "Archivo", status: "fail", detail: "Solo se aceptan archivos ZIP." }],
      });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setZipResult({
        overall: "invalid",
        results: [{ step: "Archivo", status: "fail", detail: "El archivo excede 100MB." }],
      });
      return;
    }
    setZipFile(file);
    setZipVerifying(true);
    setZipResult(null);
    try {
      const result = await verifyEvidencePack(file);
      setZipResult(result);
    } catch {
      setZipResult({
        overall: "invalid",
        results: [{ step: "Error", status: "fail", detail: "Error al procesar el Evidence Pack." }],
      });
    } finally {
      setZipVerifying(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleZipDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setZipDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleZipUpload(file);
  }, [handleZipUpload]);

  const handleZipInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleZipUpload(file);
  }, [handleZipUpload]);

  const statusIcon = (status: string) => {
    switch (status) {
      case "pass": return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
      case "fail": return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
      case "warn": return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
      default: return <FileText className="h-4 w-4 text-blue-500 shrink-0" />;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-bold text-xl tracking-tight" style={{ color: "#1a1a2e" }}>
              ANDROMEDA LEGAL
            </h1>
            <p className="text-xs text-muted-foreground">Plataforma de Gestión Legal</p>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            <span className="text-xs">Verificación segura</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto" style={{ color: "#1a1a2e" }} />
          <h1 className="text-3xl font-bold">Verificar Documento</h1>
          <p className="text-muted-foreground">
            Verifique la autenticidad e integridad de documentos firmados y Evidence Packs.
          </p>
        </div>

        <Tabs defaultValue="evidence-pack" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="evidence-pack" className="gap-2">
              <Package className="h-4 w-4" />
              Evidence Pack (ZIP)
            </TabsTrigger>
            <TabsTrigger value="single-pdf" className="gap-2">
              <FileText className="h-4 w-4" />
              PDF Individual
            </TabsTrigger>
          </TabsList>

          {/* Evidence Pack ZIP verification */}
          <TabsContent value="evidence-pack" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Verificar Evidence Pack
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Suba el archivo ZIP del Evidence Pack. Se verificarán todos los hashes,
                  la integridad de la cadena de eventos, y la correspondencia entre artefactos.
                </p>

                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                    zipDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setZipDragOver(true); }}
                  onDragLeave={() => setZipDragOver(false)}
                  onDrop={handleZipDrop}
                  onClick={() => document.getElementById("zip-upload")?.click()}
                >
                  <input
                    id="zip-upload"
                    type="file"
                    accept=".zip"
                    onChange={handleZipInput}
                    className="hidden"
                  />
                  {zipVerifying ? (
                    <div className="space-y-2">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                      <p className="text-sm text-muted-foreground">Verificando Evidence Pack...</p>
                    </div>
                  ) : zipFile ? (
                    <div className="space-y-2">
                      <Package className="h-8 w-8 mx-auto text-primary" />
                      <p className="text-sm font-medium">{zipFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(zipFile.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Arrastre el Evidence Pack ZIP aquí o haga clic para seleccionar
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ZIP verification results */}
            {zipResult && (
              <Card className={
                zipResult.overall === "valid"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-red-200 bg-red-50/50"
              }>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-3">
                    {zipResult.overall === "valid" ? (
                      <CheckCircle2 className="h-10 w-10 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="h-10 w-10 text-red-500 shrink-0" />
                    )}
                    <div>
                      <h3 className="text-lg font-bold">
                        {zipResult.overall === "valid"
                          ? "Evidence Pack Válido ✓"
                          : "Evidence Pack Inválido ✗"
                        }
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {zipResult.results.filter(r => r.status === "pass").length} de{" "}
                        {zipResult.results.filter(r => r.status !== "info").length} verificaciones pasaron
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {zipResult.results.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded border bg-white/80">
                        {statusIcon(r.status)}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{r.step}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                r.status === "pass" ? "text-emerald-600 border-emerald-300" :
                                r.status === "fail" ? "text-red-600 border-red-300" :
                                r.status === "warn" ? "text-amber-600 border-amber-300" :
                                "text-blue-600 border-blue-300"
                              }`}
                            >
                              {r.status === "pass" ? "OK" : r.status === "fail" ? "FALLA" : r.status === "warn" ? "AVISO" : "INFO"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{r.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Single PDF verification (existing) */}
          <TabsContent value="single-pdf" className="space-y-6">
            {/* PDF Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Subir documento PDF
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("pdf-upload")?.click()}
                >
                  <input
                    id="pdf-upload"
                    type="file"
                    accept=".pdf"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                  {computingHash ? (
                    <div className="space-y-2">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                      <p className="text-sm text-muted-foreground">Calculando hash del documento...</p>
                    </div>
                  ) : uploadedFile ? (
                    <div className="space-y-2">
                      <FileText className="h-8 w-8 mx-auto text-primary" />
                      <p className="text-sm font-medium">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Arrastre un archivo aquí o haga clic para seleccionar
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Formatos aceptados: PDF (máx. 10MB)
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Hash Input */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">o verificar con hash SHA-256</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Verificar por Hash SHA-256
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pegue el hash SHA-256 del documento que desea verificar.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={hashInput}
                    onChange={(e) => setHashInput(e.target.value)}
                    placeholder="e.g. a1b2c3d4e5f6..."
                    className="font-mono text-sm"
                  />
                  <Button onClick={() => handleVerify()} disabled={verifying || !hashInput.trim()}>
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Single PDF Result */}
            {result && (
              <Card className={result.verified ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    {result.verified ? (
                      <CheckCircle2 className="h-12 w-12 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-12 w-12 text-red-500 flex-shrink-0" />
                    )}
                    <div className="space-y-3">
                      <h3 className="text-lg font-bold">{result.message}</h3>
                      {result.verified && result.document && (
                        <div className="space-y-2 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <span className="text-muted-foreground">Documento</span>
                            <span className="font-medium">{result.document.title}</span>
                            <span className="text-muted-foreground">Firmante</span>
                            <span className="font-medium">{result.document.signer_name}</span>
                            <span className="text-muted-foreground">Fecha de firma</span>
                            <span className="font-medium">
                              {new Date(result.document.signed_at).toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}
                            </span>
                            <span className="text-muted-foreground">Método</span>
                            <span className="font-medium">Firma manuscrita digital</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">{result.legal_notice}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <div className="text-center text-xs text-muted-foreground space-y-1">
          <p>Firma electrónica segura — Andromeda Legal</p>
          <p>Ley 527 de 1999 · Decreto 2364 de 2012 · Decreto 806 de 2020</p>
        </div>
      </main>
    </div>
  );
}
