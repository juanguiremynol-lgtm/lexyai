/**
 * TermsAcceptanceModal — Full-screen modal that shows T&C + Privacy Notice.
 * Enforces scroll-to-bottom before enabling checkboxes.
 * Used during registration and re-acceptance flows.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Printer, FileText, ShieldCheck, Loader2 } from "lucide-react";
import { TERMS_FULL_TEXT, TERMS_VERSION, TERMS_LAST_UPDATED, OPERADOR } from "@/lib/terms-text";

interface TermsAcceptanceModalProps {
  onAccept: (data: {
    checkboxTerms: boolean;
    checkboxAge: boolean;
    checkboxMarketing: boolean;
  }) => void;
  loading?: boolean;
  /** If true, this is a re-acceptance (version changed) */
  isReAcceptance?: boolean;
}

export function TermsAcceptanceModal({
  onAccept,
  loading = false,
  isReAcceptance = false,
}: TermsAcceptanceModalProps) {
  const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);
  const [checkTerms, setCheckTerms] = useState(false);
  const [checkAge, setCheckAge] = useState(false);
  const [checkMarketing, setCheckMarketing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detect scroll to bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 50;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (atBottom && !hasScrolledToEnd) {
      setHasScrolledToEnd(true);
    }
  }, [hasScrolledToEnd]);

  // Attach scroll listener to the viewport inside ScrollArea
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // ScrollArea from radix wraps content in a viewport div
    const viewport = el.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement;
    if (viewport) {
      viewport.addEventListener("scroll", () => {
        const threshold = 50;
        const atBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < threshold;
        if (atBottom && !hasScrolledToEnd) {
          setHasScrolledToEnd(true);
        }
      });
    }
  }, [hasScrolledToEnd]);

  const canSubmit = hasScrolledToEnd && checkTerms && checkAge && !loading;

  const handleDownload = () => {
    const blob = new Blob([TERMS_FULL_TEXT], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Terminos_Condiciones_ANDROMEDA_${TERMS_VERSION}.txt`;
    link.click();
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>Términos y Condiciones - ANDROMEDA</title>
        <style>body{font-family:serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.8;white-space:pre-wrap;}</style>
        </head><body>${TERMS_FULL_TEXT}</body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[#d4a017]/30 bg-[#0c1529] shadow-[0_0_80px_rgba(212,160,23,0.12)] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#1a3a6a]/40">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-[#d4a017]/10">
              <FileText className="h-5 w-5 text-[#d4a017]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {isReAcceptance
                  ? "Nuevos Términos y Condiciones"
                  : "Términos y Condiciones de Uso"}
              </h2>
              <p className="text-xs text-[#a0b4d0]">
                ANDROMEDA (Colombia) — Versión {TERMS_VERSION} · Actualizado: {TERMS_LAST_UPDATED}
              </p>
            </div>
          </div>
          {isReAcceptance && (
            <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <p className="text-sm text-amber-300">
                Los Términos y Condiciones han sido actualizados. Para continuar usando la plataforma,
                debes leer y aceptar la nueva versión.
              </p>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="text-[#a0b4d0] hover:text-white hover:bg-[#1a3a6a]/30 text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Descargar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handlePrint}
              className="text-[#a0b4d0] hover:text-white hover:bg-[#1a3a6a]/30 text-xs"
            >
              <Printer className="h-3.5 w-3.5 mr-1" />
              Imprimir
            </Button>
          </div>
        </div>

        {/* Scrollable Terms Text */}
        <div ref={scrollRef} className="flex-1 min-h-0">
          <ScrollArea className="h-[40vh]">
            <div className="px-6 py-4">
              <pre className="whitespace-pre-wrap text-sm text-[#c0d0e8] leading-relaxed font-sans">
                {TERMS_FULL_TEXT}
              </pre>
            </div>
          </ScrollArea>
        </div>

        {/* Scroll indicator */}
        {!hasScrolledToEnd && (
          <div className="px-6 py-2 bg-[#0ea5e9]/5 border-t border-[#0ea5e9]/20 text-center">
            <p className="text-xs text-[#0ea5e9] animate-pulse">
              ↓ Desplázate hasta el final del documento para continuar ↓
            </p>
          </div>
        )}

        {/* Checkboxes + Submit */}
        <div className="px-6 py-5 border-t border-[#1a3a6a]/40 space-y-4 bg-[#0a1120]/80">
          {/* Checkbox 1: T&C + Privacy (MANDATORY) */}
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              hasScrolledToEnd
                ? "border-[#1a3a6a]/50 hover:border-[#d4a017]/30 cursor-pointer"
                : "border-[#1a3a6a]/20 opacity-50 cursor-not-allowed"
            }`}
          >
            <Checkbox
              checked={checkTerms}
              onCheckedChange={(v) => setCheckTerms(!!v)}
              disabled={!hasScrolledToEnd}
              className="mt-0.5"
            />
            <span className="text-sm text-[#c0d0e8]">
              He leído y acepto los <strong>Términos y Condiciones de Uso</strong> y el{" "}
              <strong>Aviso de Privacidad</strong>.{" "}
              <span className="text-red-400">*</span>
            </span>
          </label>

          {/* Checkbox 2: Age (MANDATORY) */}
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              hasScrolledToEnd
                ? "border-[#1a3a6a]/50 hover:border-[#d4a017]/30 cursor-pointer"
                : "border-[#1a3a6a]/20 opacity-50 cursor-not-allowed"
            }`}
          >
            <Checkbox
              checked={checkAge}
              onCheckedChange={(v) => setCheckAge(!!v)}
              disabled={!hasScrolledToEnd}
              className="mt-0.5"
            />
            <span className="text-sm text-[#c0d0e8]">
              Declaro que soy mayor de 18 años, o que actúo con consentimiento y bajo la
              gestión de mi padre/madre, tutor(a), persona de apoyo o curador(a), según
              corresponda. <span className="text-red-400">*</span>
            </span>
          </label>

          {/* Checkbox 3: Marketing (OPTIONAL) */}
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              hasScrolledToEnd
                ? "border-[#1a3a6a]/50 hover:border-[#d4a017]/30 cursor-pointer"
                : "border-[#1a3a6a]/20 opacity-50 cursor-not-allowed"
            }`}
          >
            <Checkbox
              checked={checkMarketing}
              onCheckedChange={(v) => setCheckMarketing(!!v)}
              disabled={!hasScrolledToEnd}
              className="mt-0.5"
            />
            <span className="text-sm text-[#c0d0e8]">
              Acepto recibir comunicaciones comerciales y/o informativas.{" "}
              <span className="text-[#a0b4d0]/60">(opcional)</span>
            </span>
          </label>

          {/* Operator info */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#d4a017]/5 border border-[#d4a017]/15">
            <ShieldCheck className="h-4 w-4 text-[#d4a017] mt-0.5 shrink-0" />
            <p className="text-xs text-[#a0b4d0]/80">
              Operador: {OPERADOR.razonSocial} · NIT {OPERADOR.nit} ·{" "}
              {OPERADOR.domicilio}
            </p>
          </div>

          {/* Submit */}
          <Button
            onClick={() =>
              onAccept({
                checkboxTerms: checkTerms,
                checkboxAge: checkAge,
                checkboxMarketing: checkMarketing,
              })
            }
            disabled={!canSubmit}
            className="w-full bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              "Aceptar y continuar"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
