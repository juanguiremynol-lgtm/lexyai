/**
 * DateWithConfidence Component
 * 
 * Displays a date with confidence indicator.
 * Shows tooltips explaining how the date was determined.
 */

import * as React from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '@/components/ui/tooltip';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DateSource, DateConfidence } from '@/lib/date-inference';
import { getConfidenceDisplayInfo } from '@/lib/date-inference';

interface DateWithConfidenceProps {
  date: string | null | undefined;
  dateSource?: DateSource;
  dateConfidence?: DateConfidence;
  className?: string;
  showIcon?: boolean;
  formatStr?: string;
}

export function DateWithConfidence({
  date,
  dateSource = 'api_explicit',
  dateConfidence = 'high',
  className,
  showIcon = true,
  formatStr = "d 'de' MMMM, yyyy"
}: DateWithConfidenceProps) {
  if (!date) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        Fecha no disponible
      </span>
    );
  }

  const displayInfo = getConfidenceDisplayInfo(dateConfidence, dateSource);
  
  // Parse and format the date
  let formattedDate: string;
  try {
    const dateObj = new Date(date + 'T12:00:00');
    formattedDate = format(dateObj, formatStr, { locale: es });
  } catch {
    formattedDate = date;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            className={cn(
              'inline-flex items-center gap-1 cursor-help',
              displayInfo.className,
              className
            )}
          >
            {formattedDate}
            {displayInfo.showWarning && showIcon && (
              <AlertCircle className="h-3 w-3 text-orange-500" />
            )}
            {dateConfidence === 'low' && ' *'}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">{displayInfo.label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {displayInfo.tooltip}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact date display for tables/lists
 */
interface DateCompactProps {
  date: string | null | undefined;
  dateConfidence?: DateConfidence;
  className?: string;
}

export function DateCompact({
  date,
  dateConfidence = 'high',
  className
}: DateCompactProps) {
  if (!date) {
    return <span className={cn('text-muted-foreground text-sm', className)}>—</span>;
  }

  let formattedDate: string;
  try {
    const dateObj = new Date(date + 'T12:00:00');
    formattedDate = format(dateObj, 'dd/MM/yyyy', { locale: es });
  } catch {
    formattedDate = date;
  }

  const confidenceStyles: Record<DateConfidence, string> = {
    high: '',
    medium: 'text-warning',
    low: 'text-destructive italic'
  };

  return (
    <span className={cn(confidenceStyles[dateConfidence], className)}>
      {formattedDate}
      {dateConfidence === 'low' && ' *'}
    </span>
  );
}
