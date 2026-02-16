/**
 * LegalTermsPage — Public page showing the full T&C and Privacy Policy.
 * 
 * PUBLIC tabs: Terms text + version history (no user data)
 * AUTHENTICATED tab: User's own acceptance summary (no IP/user_agent — data minimization)
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchActiveTerms, getUserAcceptanceHistory, type ActiveTermsData } from "@/lib/terms-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, History, ShieldCheck, Loader2 } from "lucide-react";

export default function LegalTermsPage() {
  const [tab, setTab] = useState("terms");

  // Fetch canonical terms from DB
  const { data: activeTerms, isLoading: termsLoading } = useQuery({
    queryKey: ["active-terms-legal"],
    queryFn: fetchActiveTerms,
    staleTime: 5 * 60 * 1000,
  });

  const { data: versions } = useQuery({
    queryKey: ["terms-versions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("terms_versions")
        .select("version, last_updated, active, created_at")
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  // Only fetch acceptance history for authenticated users — summary only (no PII)
  const { data: acceptanceHistory } = useQuery({
    queryKey: ["terms-acceptance-history"],
    queryFn: getUserAcceptanceHistory,
  });

  const handleDownload = () => {
    if (!activeTerms) return;
    const blob = new Blob([activeTerms.termsText], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Terminos_ANDROMEDA_${activeTerms.termsVersion}.txt`;
    link.click();
  };

  return (
    <div className="container max-w-4xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Legal</h1>
        <p className="text-[#a0b4d0]">
          Términos y Condiciones de Uso, Política de Privacidad e historial de versiones.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="bg-[#0c1529] border border-[#1a3a6a]/40">
          <TabsTrigger value="terms" className="data-[state=active]:bg-[#1a3a6a]/40">
            <FileText className="h-4 w-4 mr-2" />
            Términos Vigentes
          </TabsTrigger>
          <TabsTrigger value="versions" className="data-[state=active]:bg-[#1a3a6a]/40">
            <History className="h-4 w-4 mr-2" />
            Historial de Versiones
          </TabsTrigger>
          {acceptanceHistory && acceptanceHistory.length > 0 && (
            <TabsTrigger value="acceptance" className="data-[state=active]:bg-[#1a3a6a]/40">
              <ShieldCheck className="h-4 w-4 mr-2" />
              Mis Aceptaciones
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="terms">
          <Card className="border-[#1a3a6a]/40 bg-[#0c1529]/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-white">
                  Términos y Condiciones de Uso
                </CardTitle>
                {activeTerms && (
                  <p className="text-sm text-[#a0b4d0] mt-1">
                    Versión {activeTerms.termsVersion} · Actualizado: {activeTerms.termsLastUpdated}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleDownload}
                disabled={!activeTerms}
                className="border-[#1a3a6a]/50 text-[#a0b4d0] hover:text-white hover:bg-[#1a3a6a]/30">
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </Button>
            </CardHeader>
            <CardContent>
              {termsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-[#d4a017]" />
                </div>
              ) : activeTerms ? (
                <>
                  <pre className="whitespace-pre-wrap text-sm text-[#c0d0e8] leading-relaxed font-sans max-h-[70vh] overflow-y-auto">
                    {activeTerms.termsText}
                  </pre>
                  <div className="mt-6 p-4 rounded-lg bg-[#d4a017]/5 border border-[#d4a017]/15">
                    <p className="text-xs text-[#a0b4d0]">
                      <strong>Operador:</strong> {activeTerms.operador.razonSocial} · NIT {activeTerms.operador.nit}<br />
                      <strong>Domicilio:</strong> {activeTerms.operador.domicilio}<br />
                      <strong>Contacto:</strong> {activeTerms.operador.correo} · Tel: {activeTerms.operador.telefono}<br />
                      <strong>Privacidad:</strong> {activeTerms.operador.correoPrivacidad}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-[#a0b4d0]">No se pudieron cargar los términos.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <Card className="border-[#1a3a6a]/40 bg-[#0c1529]/80">
            <CardHeader>
              <CardTitle className="text-white">Historial de Versiones</CardTitle>
            </CardHeader>
            <CardContent>
              {versions && versions.length > 0 ? (
                <div className="space-y-3">
                  {versions.map((v) => (
                    <div
                      key={v.version}
                      className="flex items-center justify-between p-4 rounded-lg border border-[#1a3a6a]/30 bg-[#0a1120]/50"
                    >
                      <div>
                        <span className="font-medium text-white">{v.version}</span>
                        <span className="text-sm text-[#a0b4d0] ml-3">
                          Actualizado: {v.last_updated}
                        </span>
                      </div>
                      {v.active && (
                        <Badge className="bg-green-500/15 text-green-400 border-green-500/30">
                          Vigente
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#a0b4d0]">No hay versiones registradas.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* User acceptance summary — authenticated only, no PII (no IP/user_agent) */}
        {acceptanceHistory && acceptanceHistory.length > 0 && (
          <TabsContent value="acceptance">
            <Card className="border-[#1a3a6a]/40 bg-[#0c1529]/80">
              <CardHeader>
                <CardTitle className="text-white">Mis Registros de Aceptación</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {acceptanceHistory.map((a: any) => (
                    <div
                      key={a.id}
                      className="p-4 rounded-lg border border-[#1a3a6a]/30 bg-[#0a1120]/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">
                          Versión T&C: {a.terms_version}
                          {a.privacy_policy_version && (
                            <span className="text-[#a0b4d0] font-normal ml-2">
                              · Política: {a.privacy_policy_version}
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-[#a0b4d0]">
                          {new Date(a.accepted_at).toLocaleString("es-CO")}
                        </span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          T&C: {a.checkbox_terms ? "✓" : "✗"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Edad: {a.checkbox_age ? "✓" : "✗"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Marketing: {a.checkbox_marketing ? "✓" : "✗"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Método: {a.acceptance_method}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
