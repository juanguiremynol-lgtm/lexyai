/**
 * /demo — Shareable public micro-page for the demo lookup widget.
 *
 * Supports query params:
 *   ?radicado=05001... — pre-fill and auto-run
 *   ?frame=androMouth|none — toggle robot frame (default: androMouth)
 *   ?variant=compact|full — widget variant (default: full)
 *
 * Includes Open Graph metadata for social sharing.
 */

import { useSearchParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { DemoLookupWidget } from "@/components/demo/DemoLookupWidget";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DemoPage() {
  const [searchParams] = useSearchParams();

  const radicado = searchParams.get("radicado") || undefined;
  const frame = (searchParams.get("frame") as "androMouth" | "none") || "androMouth";
  const variant = (searchParams.get("variant") as "full" | "compact") || "full";
  const autoRun = !!radicado && radicado.replace(/\D/g, "").length === 23;

  const ogImageUrl = "https://lexyai.lovable.app/og-banner.png";

  return (
    <>
      <Helmet>
        <title>Prueba Andro IA — Demo en vivo | Andromeda</title>
        <meta
          name="description"
          content="Ingresa un radicado colombiano y mira en segundos cómo Andro IA organiza actuaciones, estados y gestiona tu caso. Sin registro."
        />
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Prueba Andro IA con un radicado real" />
        <meta
          property="og:description"
          content="Pega un radicado y ve partes, despacho, actuaciones y estados en segundos — más un pipeline Kanban. Impulsado por Andro IA."
        />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:url" content="https://lexyai.lovable.app/demo" />
        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Prueba Andro IA con un radicado real" />
        <meta
          name="twitter:description"
          content="Pega un radicado y ve partes, despacho, actuaciones y estados en segundos — más un pipeline Kanban."
        />
        <meta name="twitter:image" content={ogImageUrl} />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-muted/30 via-muted/50 to-muted/30">
        {/* Top nav */}
        <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
        </nav>

        {/* Widget */}
        <main className="py-8 md:py-16">
          <DemoLookupWidget
            variant={variant}
            frame={frame}
            initialRadicado={radicado}
            autoRun={autoRun}
            ctaMode="signup"
          />
        </main>

        {/* Bottom CTA */}
        <div className="text-center pb-16 space-y-3">
          <p className="text-sm text-muted-foreground">
            ¿Quieres gestionar todos tus procesos con Andro IA?
          </p>
          <Button asChild size="lg">
            <Link to="/auth?signup=true">
              Crear cuenta gratis — 3 meses
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
