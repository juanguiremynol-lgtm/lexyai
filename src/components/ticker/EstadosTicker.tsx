import { useNavigate } from "react-router-dom";
import { memo, useMemo } from "react";
import { useUnifiedTicker, type TickerItem } from "@/hooks/use-unified-ticker";
import { cn } from "@/lib/utils";
import { 
  Scale, 
  Gavel, 
  Briefcase, 
  FileText, 
  AlertTriangle, 
  Calendar,
  Bell 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Workflow type icons
const WORKFLOW_ICONS: Record<string, React.ElementType> = {
  CGP: FileText,
  CPACA: Scale,
  TUTELA: Gavel,
  LABORAL: Briefcase,
  PENAL_906: Gavel,
};

// Workflow type colors (using semantic tokens)
const WORKFLOW_COLORS: Record<string, string> = {
  CGP: "text-blue-500",
  CPACA: "text-indigo-500",
  TUTELA: "text-purple-500",
  LABORAL: "text-amber-600",
  PENAL_906: "text-red-500",
};

// Severity colors
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-blue-500",
};

interface TickerItemProps {
  item: TickerItem;
  onClick: () => void;
}

const TickerItemComponent = memo(function TickerItemComponent({ item, onClick }: TickerItemProps) {
  const Icon = WORKFLOW_ICONS[item.workflow_type] || FileText;
  const colorClass = WORKFLOW_COLORS[item.workflow_type] || "text-muted-foreground";
  const severityColor = SEVERITY_COLORS[item.severity] || "bg-blue-500";
  
  // Build compact display
  const displayParts: string[] = [];
  
  if (item.radicado) {
    const rad = item.radicado.length > 15 
      ? item.radicado.slice(-15) 
      : item.radicado;
    displayParts.push(rad);
  }
  
  if (item.authority_name) {
    const auth = item.authority_name.length > 30 
      ? item.authority_name.slice(0, 27) + "..." 
      : item.authority_name;
    displayParts.push(auth);
  }
  
  // Content (shortened)
  const contentShort = item.content.length > 35 
    ? item.content.slice(0, 32) + "..." 
    : item.content;
  displayParts.push(contentShort);

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-1.5 mx-2",
        "text-sm font-medium whitespace-nowrap",
        "hover:bg-accent/50 rounded transition-colors cursor-pointer",
        "focus:outline-none focus:ring-1 focus:ring-ring"
      )}
    >
      {/* Severity indicator dot */}
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", severityColor)} />
      
      {/* Type badge */}
      <Badge 
        variant={item.type === 'ESTADO' ? 'default' : 'secondary'} 
        className="text-[10px] px-1.5 py-0 h-4"
      >
        {item.type === 'ESTADO' ? 'EST' : 'ACT'}
      </Badge>
      
      {/* Workflow icon + type */}
      <span className={cn("flex items-center gap-1 font-bold", colorClass)}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs">{item.workflow_type}</span>
      </span>
      
      <span className="text-muted-foreground">|</span>
      
      {/* Main content */}
      <span className="text-foreground/90">{displayParts.join(" — ")}</span>
      
      {/* Warning: Missing fecha_desfijacion for estados */}
      {item.type === 'ESTADO' && item.missing_fecha_desfijacion && (
        <span className="inline-flex items-center gap-1 text-amber-500 text-xs">
          <AlertTriangle className="h-3 w-3" />
          <span className="hidden sm:inline">Sin desfijación</span>
        </span>
      )}
      
      {/* Deadline info when available */}
      {item.is_deadline_trigger && item.terminos_inician && (
        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
          <Calendar className="h-3 w-3" />
          <span>Términos: {item.terminos_inician}</span>
        </span>
      )}
      
      {/* Date */}
      {item.date && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground text-xs">{item.date.split('T')[0]}</span>
        </>
      )}
    </button>
  );
});

export function EstadosTicker() {
  const navigate = useNavigate();
  const { 
    items, 
    isLoading, 
    showTicker, 
    criticalCount, 
    missingDesfijacionCount 
  } = useUnifiedTicker({
    limit: 50,
    refetchIntervalSeconds: 60,
    enableRealtime: true,
  });

  // Duplicate items for seamless infinite scroll - memoized before any returns
  const duplicatedItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  // Calculate animation duration based on number of items
  // More items = longer duration for comfortable reading
  const animationDuration = useMemo(() => {
    if (!items) return 16;
    return Math.max(items.length * 2.5, 16);
  }, [items]);

  // Don't render if disabled or loading settings
  if (isLoading || !showTicker) {
    return null;
  }

  // Don't render if no items
  if (!items || items.length === 0) {
    return null;
  }

  const handleItemClick = (workItemId: string) => {
    navigate(`/app/work-items/${workItemId}?tab=estados`);
  };

  return (
    <div 
      className="w-full bg-card border-b border-border overflow-hidden relative z-40"
      role="marquee"
      aria-label="Actualizaciones judiciales recientes"
    >
      {/* Critical items indicator */}
      {(criticalCount > 0 || missingDesfijacionCount > 0) && (
        <div className="absolute left-0 top-0 bottom-0 flex items-center px-3 bg-card z-10 border-r border-border">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                {criticalCount}
              </Badge>
            )}
            {missingDesfijacionCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500 text-amber-500">
                ⚠️ {missingDesfijacionCount}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Scrolling container */}
      <div 
        className={cn(
          "flex items-center py-1.5 ticker-scroll whitespace-nowrap",
          (criticalCount > 0 || missingDesfijacionCount > 0) ? "pl-24" : "pl-4"
        )}
        style={{
          animation: `ticker-scroll ${animationDuration}s linear infinite`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.animationPlayState = 'paused';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.animationPlayState = 'running';
        }}
      >
        {duplicatedItems.map((item, index) => (
          <TickerItemComponent
            key={`${item.id}-${index}`}
            item={item}
            onClick={() => handleItemClick(item.work_item_id)}
          />
        ))}
      </div>

      {/* Gradient fade on right */}
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-card to-transparent pointer-events-none" />
    </div>
  );
}

export default EstadosTicker;
