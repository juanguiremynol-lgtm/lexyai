/**
 * /demo — Shareable public micro-page for the demo lookup widget.
 *
 * OG/Twitter meta tags are served from static HTML (public/demo/index.html)
 * so crawlers see them without executing JS. This component handles the
 * interactive SPA experience after hydration.
 *
 * Supports query params:
 *   ?radicado=05001... — pre-fill and auto-run
 *   ?frame=androMouth|none — toggle robot frame (default: androMouth)
 *   ?variant=compact|full — widget variant (default: full)
 *   ?autorun=0|1 — explicit auto-run control
 */

import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { DemoLookupWidget } from "@/components/demo/DemoLookupWidget";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/wrapper";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

/**
 * OG image uses a versioned filename (not query-param) for reliable cache busting.
 * Static HTML in public/demo/index.html is the PRIMARY source of OG tags for crawlers.
 * The constants below are used only for the DEV debug panel.
 */
const OG_BASE_URL = "https://andromeda.legal";
const OG_IMAGE_URL = `${OG_BASE_URL}/og-demo-v4.png`;

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
  );
}

/** Dev-only debug block showing computed OG fields + deep-link diagnostics */
function SharePreviewDebug({ ogImageUrl, baseUrl }: { ogImageUrl: string; baseUrl: string }) {
  const navEntries = window.performance?.getEntriesByType?.("navigation") ?? [];
  const isDirectNav = (navEntries[0] as PerformanceNavigationTiming | undefined)?.type === "navigate"
    || !document.referrer;

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
        <p><strong>og:image:height:</strong> 630</p>
        <p><strong>og:url:</strong> {baseUrl}/demo</p>
        <p><strong>twitter:card:</strong> summary_large_image</p>
        <p className="mt-2 text-green-600">
          ✅ MPA entry points active: demo/index.html and prueba/index.html
          are Vite build inputs. Script tags are transformed in production.
        </p>

        {/* Deep-link diagnostics */}
        <div className="mt-3 pt-3 border-t border-muted-foreground/20">
          <p className="font-medium text-foreground mb-1">🔗 Deep-link Diagnostics</p>
          <p><strong>window.location.href:</strong> {window.location.href}</p>
          <p><strong>Navigation type:</strong> {isDirectNav ? "Direct / deep-link" : "Client-side navigation"}</p>
          <p className={isDirectNav ? "text-green-600" : "text-amber-500"}>
            {isDirectNav ? "✅ Server deep-link OK — page loaded via direct navigation" : "⚠️ Client-side navigation — deep-link not tested in this session"}
          </p>
          <p><strong>Share URLs use:</strong> {baseUrl} (production canonical)</p>
        </div>

        <p className="mt-2">
          Test: <a href={`https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(baseUrl + '/demo')}`} target="_blank" rel="noopener" className="text-primary underline">Facebook Debugger</a>
          {" | "}
          <a href="https://cards-dev.twitter.com/validator" target="_blank" rel="noopener" className="text-primary underline">Twitter Validator</a>
          {" | "}
          <a href={`https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(baseUrl + '/demo')}`} target="_blank" rel="noopener" className="text-primary underline">LinkedIn Inspector</a>
        </p>

        {/* Verification checklist */}
        <div className="mt-3 pt-3 border-t border-muted-foreground/20">
          <p className="font-medium text-foreground mb-1">✅ Verification Checklist</p>
          <p>1. <code>curl -I {baseUrl}/demo</code> → expect HTTP 200</p>
          <p>2. <code>curl -I "{baseUrl}/demo?variant=full&frame=androMouth&autorun=0"</code> → expect HTTP 200</p>
          <p>3. Paste link in Facebook → opens without 404</p>
          <p>4. Facebook Sharing Debugger → "Scrape Again" → 200 + correct OG</p>
        </div>
      </div>
    </details>
  );
}
