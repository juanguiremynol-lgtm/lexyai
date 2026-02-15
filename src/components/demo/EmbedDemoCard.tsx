/**
 * EmbedDemoCard — Lightweight embed wrapper for partners/blog.
 * Shows compact widget with Andro frame and a CTA below.
 */

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { DemoLookupWidget } from "./DemoLookupWidget";

interface EmbedDemoCardProps {
  className?: string;
}

export function EmbedDemoCard({ className = "" }: EmbedDemoCardProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      <DemoLookupWidget
        variant="compact"
        frame="androMouth"
        ctaMode="none"
      />
      <div className="text-center">
        <Button asChild>
          <Link to="/auth?signup=true">
            Comienza gratis con Andromeda
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
