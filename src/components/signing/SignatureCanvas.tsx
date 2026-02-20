/**
 * SignatureCanvas — Draw-to-sign component using HTML5 Canvas.
 * Touch-optimized for mobile signing. Exports PNG data URL.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Check } from "lucide-react";

interface SignatureCanvasProps {
  onConfirm: (dataUrl: string) => void;
  penColor?: string;
  penWidth?: number;
}

export function SignatureCanvas({
  onConfirm,
  penColor = "#1a1a2e",
  penWidth = 2,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = "200px";

    const context = canvas.getContext("2d");
    if (context) {
      context.scale(dpr, dpr);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = penColor;
      context.lineWidth = penWidth;
      setCtx(context);
    }
  }, [penColor, penWidth]);

  const getPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
    },
    []
  );

  const startDraw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!ctx) return;
      e.preventDefault();
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
      setIsEmpty(false);
    },
    [ctx, getPos]
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || !ctx) return;
      e.preventDefault();
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    [isDrawing, ctx, getPos]
  );

  const endDraw = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clear = useCallback(() => {
    if (!ctx || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    setIsEmpty(true);
  }, [ctx]);

  const handleConfirm = useCallback(() => {
    if (!canvasRef.current || isEmpty) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onConfirm(dataUrl);
  }, [isEmpty, onConfirm]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Dibuje su firma con el dedo o lápiz digital
      </p>
      <div
        className="border-2 border-dashed rounded-lg bg-white dark:bg-card overflow-hidden relative"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground/40 text-sm">Firme aquí</p>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={clear} disabled={isEmpty}>
          <Eraser className="h-4 w-4 mr-1" /> Limpiar
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={isEmpty} className="flex-1">
          <Check className="h-4 w-4 mr-1" /> Confirmar firma
        </Button>
      </div>
    </div>
  );
}
