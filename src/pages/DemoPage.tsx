/**
 * /demo — Shareable public micro-page for the demo lookup widget.
 *
 * Supports query params:
 *   ?radicado=05001... — pre-fill and auto-run
 *   ?frame=androMouth|none — toggle robot frame (default: androMouth)
 *   ?variant=compact|full — widget variant (default: full)
 *   ?autorun=0|1 — explicit auto-run control
 *
 * Includes Open Graph + Twitter metadata for social sharing.
 */

import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { DemoLookupWidget } from "@/components/demo/DemoLookupWidget";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/wrapper";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

/** Cache-busted OG image version — bump when updating the image */
const OG_IMAGE_VERSION = "v4";
const OG_BASE_URL = "https://lexyai.lovable.app";
const OG_IMAGE_URL = `${OG_BASE_URL}/og-banner.png?${OG_IMAGE_VERSION}`;

export default function DemoPage() {
  const [searchParams] = useSearchParams();

  const radicado = searchParams.get("radicado") || undefined;
  const frame = (searchParams.get("frame") as "androMouth" | "none") || "androMouth";
  const variant = (searchParams.get("variant") as "full" | "compact") || "full";
  const autorunParam = searchParams.get("autorun");
  // Default: auto-run if radicado is valid and autorun is not explicitly "0"
  const autoRun = !!radicado
    && radicado.replace(/\D/g, "").length === 23
    && autorunParam !== "0";

  // Analytics: track demo page view
  useEffect(() => {
    track(ANALYTICS_EVENTS.DEMO_VIEW, {
      variant,
      frame,
      has_radicado: !!radicado,
      source: document.referrer ? "referral" : "direct",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCtaClick = (ctaType: string) => {
    track(ANALYTICS_EVENTS.DEMO_CTA_CLICKED, { cta_type: ctaType });
  };

  return (
    <>
      <Helmet>
        <title>Prueba Andro IA — Demo en vivo | Andromeda</title>
        <meta
          name="description"
          content="Ingresa un radicado colombiano y mira en segundos cómo Andro IA organiza actuaciones, estados y gestiona tu caso. Sin registro."
        />
        <link rel="canonical" href={`${OG_BASE_URL}/demo`} />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Prueba Andro IA con un radicado real" />
        <meta
          property="og:description"
          content="Pega un radicado y ve partes, despacho, actuaciones y estados en segundos — más un pipeline Kanban. Impulsado por Andro IA."
        />
        <meta property="og:image" content={OG_IMAGE_URL} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Prueba Andro IA — Demo de Andromeda" />
        <meta property="og:url" content={`${OG_BASE_URL}/demo`} />
        <meta property="og:site_name" content="Andromeda" />
        <meta property="og:locale" content="es_CO" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@AndromedaLegal" />
        <meta name="twitter:title" content="Prueba Andro IA con un radicado real" />
        <meta
          name="twitter:description"
          content="Pega un radicado y ve partes, despacho, actuaciones y estados en segundos — más un pipeline Kanban."
        />
        <meta name="twitter:image" content={OG_IMAGE_URL} />
        <meta name="twitter:image:alt" content="Prueba Andro IA — Demo de Andromeda" />
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
            ctaMode="none"
          />
        </main>

        {/* Bottom dual CTA */}
        <div className="text-center pb-16 space-y-4">
          <p className="text-sm text-muted-foreground">
            ¿Quieres gestionar todos tus procesos con Andro IA?
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" onClick={() => handleCtaClick("start_free")}>
              <Link to="/auth?signup=true">
                Comenzar gratis — 3 meses
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" onClick={() => handleCtaClick("pricing")}>
              <Link to="/pricing">
                Ver precios
              </Link>
            </Button>
          </div>
        </div>

        {/* DEV: Share Preview Debug */}
        {import.meta.env.DEV && (
          <SharePreviewDebug ogImageUrl={OG_IMAGE_URL} baseUrl={OG_BASE_URL} />
        )}
      </div>
    </>
  );
}

/** Dev-only debug block showing computed OG fields */
function SharePreviewDebug({ ogImageUrl, baseUrl }: { ogImageUrl: string; baseUrl: string }) {
  return (
    <details className="max-w-2xl mx-auto mb-8 rounded-lg border border-dashed border-muted-foreground/30 p-4 text-xs font-mono">
      <summary className="cursor-pointer text-muted-foreground font-medium">
        🔧 DEV: Share Preview Debug
      </summary>
      <div className="mt-3 space-y-1 text-muted-foreground">
        <p><strong>og:title:</strong> Prueba Andro IA con un radicado real</p>
        <p><strong>og:description:</strong> Pega un radicado y ve partes, despacho, actuaciones y estados en segundos — más un pipeline Kanban. Impulsado por Andro IA.</p>
        <p><strong>og:image:</strong> {ogImageUrl}</p>
        <p><strong>og:image:width:</strong> 1200</p>
        <p><strong>og:image:height:</strong> 1200x630</p>
        <p><strong>og:url:</strong> {baseUrl}/demo</p>
        <p><strong>twitter:card:</strong> summary_large_image</p>
        <p className="mt-2 text-amber-500">
          ⚠ SPA limitation: Facebook/LinkedIn crawlers may not see Helmet-injected tags.
          For reliable previews, ensure SSR/prerendering is configured for /demo and /prueba.
        </p>
        <p>
          Test: <a href="https://developers.facebook.com/tools/debug/" target="_blank" rel="noopener" className="text-primary underline">Facebook Debugger</a>
          {" | "}
          <a href="https://cards-dev.twitter.com/validator" target="_blank" rel="noopener" className="text-primary underline">Twitter Validator</a>
        </p>
      </div>
    </details>
  );
}
