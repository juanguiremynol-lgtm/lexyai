/**
 * SignatureCanvas — Drawn signature component using signature_pad.
 * Touch-optimized for mobile signing. Exports PNG data URL + raw stroke data.
 * Enforces minimum complexity (15+ points) for legal validity.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";
import SignaturePad from "signature_pad";

interface SignatureCanvasProps {
  onSignatureChange: (data: { dataUrl: string; strokeData: any[] } | null) => void;
}

export function SignatureCanvas({ onSignatureChange }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = 200 * ratio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = "200px";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(ratio, ratio);

    if (padRef.current && !padRef.current.isEmpty()) {
      padRef.current.clear();
      setIsEmpty(true);
      onSignatureChange(null);
      setError(null);
      // Toast handled by parent if needed
    }
  }, [onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = 200 * ratio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = "200px";
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);
    }

    const pad = new SignaturePad(canvas, {
      minWidth: 1.5,
      maxWidth: 3.5,
      penColor: "#1a1a2e",
      backgroundColor: "#ffffff",
      velocityFilterWeight: 0.7,
    });

    pad.addEventListener("beginStroke", () => {
      setError(null);
    });

    pad.addEventListener("endStroke", () => {
      setIsEmpty(pad.isEmpty());
      // Validate and notify parent on every stroke end
      const strokeData = pad.toData();
      const totalPoints = strokeData.reduce((sum: number, stroke: any) => sum + stroke.points.length, 0);
      if (totalPoints >= 15) {
        onSignatureChange({
          dataUrl: pad.toDataURL("image/png"),
          strokeData,
        });
      } else {
        onSignatureChange(null);
      }
    });

    padRef.current = pad;

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);

    return () => {
      pad.off();
      window.removeEventListener("resize", handleResize);
    };
  }, [onSignatureChange, resizeCanvas]);

  const clear = useCallback(() => {
    padRef.current?.clear();
    setIsEmpty(true);
    setError(null);
    onSignatureChange(null);
  }, [onSignatureChange]);

  const validate = useCallback((): boolean => {
    if (!padRef.current || padRef.current.isEmpty()) {
      setError("Debe dibujar su firma para continuar");
      return false;
    }
    const strokeData = padRef.current.toData();
    const totalPoints = strokeData.reduce((sum: number, stroke: any) => sum + stroke.points.length, 0);
    if (totalPoints < 15) {
      setError("Su firma debe ser más elaborada. Por favor dibújela nuevamente.");
      return false;
    }
    return true;
  }, []);

  // Expose validate via ref-like pattern
  useEffect(() => {
    (window as any).__signatureCanvasValidate = validate;
    return () => { delete (window as any).__signatureCanvasValidate; };
  }, [validate]);

  // Detect device type for instructions
  const isTouchDevice = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const instructionText = isTouchDevice
    ? "Dibuje su firma con el dedo o lápiz digital"
    : "Dibuje su firma usando el mouse o trackpad";

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {instructionText}
      </p>
      <div
        ref={containerRef}
        className={`border-2 rounded-lg overflow-hidden relative ${error ? "border-destructive" : "border-dashed border-border"}`}
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
        />
        {/* Signature guideline */}
        <div
          className="absolute left-4 right-4 pointer-events-none"
          style={{ bottom: "30%", borderBottom: "1px dashed #e5e7eb" }}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground/40 text-sm">Firme aquí</p>
          </div>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button variant="outline" size="sm" onClick={clear} disabled={isEmpty}>
        <Eraser className="h-4 w-4 mr-1" /> Limpiar
      </Button>
    </div>
  );
}
