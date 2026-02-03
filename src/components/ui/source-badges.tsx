/**
 * SourceBadges Component
 * 
 * Displays provider source badges for actuaciones, highlighting
 * multi-source confirmed records.
 */

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Provider display names
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  cpnu: 'CPNU',
  samai: 'SAMAI',
  corte_constitucional: 'Corte Const.',
  tutelas: 'API Tutelas',
  publicaciones: 'Publicaciones',
  // Legacy sources
  icarus_import: 'Icarus',
  legacy_import: 'Legacy',
  manual: 'Manual',
};

interface SourceBadgesProps {
  sources: string[];
  primarySource?: string;
  showTooltip?: boolean;
  className?: string;
}

export function SourceBadges({
  sources,
  primarySource,
  showTooltip = true,
  className,
}: SourceBadgesProps) {
  // Single source - simple badge
  if (!sources || sources.length === 0) {
    return null;
  }

  if (sources.length === 1) {
    return (
      <Badge variant="outline" className={cn('text-xs', className)}>
        {SOURCE_DISPLAY_NAMES[sources[0]] || sources[0]}
      </Badge>
    );
  }

  // Multiple sources - show verification indicator
  const badge = (
    <Badge
      variant="default"
      className={cn(
        'bg-primary text-primary-foreground text-xs gap-1',
        className
      )}
    >
      <CheckCircle2 className="h-3 w-3" />
      {sources.length} fuentes
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-semibold mb-1">
            Confirmado por {sources.length} fuentes:
          </p>
          <ul className="list-disc list-inside text-sm space-y-0.5">
            {sources.map(s => (
              <li
                key={s}
                className={cn(
                  s === primarySource && 'font-semibold text-primary'
                )}
              >
                {SOURCE_DISPLAY_NAMES[s] || s}
                {s === primarySource && ' (principal)'}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact source indicator for lists
 */
interface SourceIndicatorProps {
  sources: string[];
  className?: string;
}

export function SourceIndicator({ sources, className }: SourceIndicatorProps) {
  if (!sources || sources.length === 0) {
    return null;
  }

  const isMultiSource = sources.length > 1;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        isMultiSource ? 'text-primary' : 'text-muted-foreground',
        className
      )}
    >
      {isMultiSource && <CheckCircle2 className="h-3 w-3" />}
      <span>{isMultiSource ? 'Verificado' : SOURCE_DISPLAY_NAMES[sources[0]]}</span>
    </div>
  );
}
