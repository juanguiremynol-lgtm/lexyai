/**
 * Public Document Verification Page — Verify document integrity via SHA-256 hash or PDF upload.
 * Andromeda Legal branding (client-facing).
 */

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, CheckCircle2, XCircle, Loader2, Search, Upload, FileText, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifyDocumentPage() {
  const [hashInput, setHashInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [computingHash, setComputingHash] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <div className="min-h-screen bg-white">
      {/* Header — Andromeda Legal branding */}
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
            Verifique la autenticidad e integridad de un documento firmado a través de Andromeda Legal.
          </p>
        </div>

        {/* Method A: PDF Upload */}
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

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">o verificar con hash SHA-256</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Method B: Hash Input */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Verificar por Hash SHA-256
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Pegue el hash SHA-256 del documento que desea verificar. Este hash se incluye
              en el correo de confirmación de firma.
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

        {/* Result */}
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

        <div className="text-center text-xs text-muted-foreground space-y-1">
          <p>Firma electrónica segura — Andromeda Legal</p>
          <p>Ley 527 de 1999 · Decreto 2364 de 2012 · Decreto 806 de 2020</p>
        </div>
      </main>
    </div>
  );
}
