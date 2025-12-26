import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ClientRequiredBadgeProps {
  hasClient: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function ClientRequiredBadge({ hasClient, className, size = "sm" }: ClientRequiredBadgeProps) {
  if (hasClient) return null;

  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400",
              size === "sm" ? "h-5 w-5" : "h-6 w-6",
              className
            )}
          >
            <AlertTriangle className={iconSize} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-xs font-medium">Sin cliente vinculado</p>
          <p className="text-xs text-muted-foreground">Haz clic para vincular un cliente</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
