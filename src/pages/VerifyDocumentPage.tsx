/**
 * Public Document Verification Page — Verify document integrity via SHA-256 hash.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, CheckCircle2, XCircle, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function VerifyDocumentPage() {
  const [hashInput, setHashInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleVerify = async () => {
    if (!hashInput.trim()) return;
    setVerifying(true);
    setResult(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
        body: JSON.stringify({ document_hash: hashInput.trim().toLowerCase() }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ verified: false, message: "Error de conexión. Intente nuevamente." });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-bold text-lg">ATENIA</span>
          <Badge variant="outline" className="text-xs">Verificación de Documentos</Badge>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Verificar Documento</h1>
          <p className="text-muted-foreground">
            Verifique la autenticidad e integridad de un documento firmado electrónicamente en ATENIA.
          </p>
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
              <Button onClick={handleVerify} disabled={verifying || !hashInput.trim()}>
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
              </Button>
            </div>
          </CardContent>
        </Card>

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
                        <span className="font-medium">{result.document.signature_method === "typed" ? "Firma escrita" : "Firma dibujada"}</span>
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
          <p>ATENIA · Firma Electrónica Segura</p>
          <p>Ley 527 de 1999 · Decreto 2364 de 2012</p>
        </div>
      </main>
    </div>
  );
}
