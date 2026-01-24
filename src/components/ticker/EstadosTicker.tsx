import { useNavigate } from "react-router-dom";
import { memo, useMemo } from "react";
import { useTickerEstados, useTickerSettings, TickerItem } from "@/hooks/use-ticker-estados";
import { cn } from "@/lib/utils";
import { Scale, Gavel, Briefcase, FileText, Radio } from "lucide-react";

// Workflow type icons
const WORKFLOW_ICONS: Record<string, React.ElementType> = {
  CGP: FileText,
  CPACA: Scale,
  TUTELA: Gavel,
  LABORAL: Briefcase,
};

// Workflow type colors (using semantic tokens)
const WORKFLOW_COLORS: Record<string, string> = {
  CGP: "text-blue-500",
  CPACA: "text-indigo-500",
  TUTELA: "text-purple-500",
  LABORAL: "text-amber-600",
};

interface TickerItemProps {
  item: TickerItem;
  onClick: () => void;
}

const TickerItemComponent = memo(function TickerItemComponent({ item, onClick }: TickerItemProps) {
  const Icon = WORKFLOW_ICONS[item.workflow_type] || FileText;
  const colorClass = WORKFLOW_COLORS[item.workflow_type] || "text-muted-foreground";
  
  // Build compact display
  const displayParts: string[] = [];
  
  if (item.radicado) {
    displayParts.push(item.radicado);
  }
  
  if (item.authority_name) {
    const auth = item.authority_name.length > 35 
      ? item.authority_name.slice(0, 32) + "..." 
      : item.authority_name;
    displayParts.push(auth);
  }
  
  if (item.act_description) {
    const desc = item.act_description.length > 40 
      ? item.act_description.slice(0, 37) + "..." 
      : item.act_description;
    displayParts.push(desc);
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-1 mx-2",
        "text-sm font-medium whitespace-nowrap",
        "hover:bg-accent/50 rounded transition-colors cursor-pointer",
        "focus:outline-none focus:ring-1 focus:ring-ring"
      )}
    >
      <span className={cn("flex items-center gap-1 font-bold", colorClass)}>
        <Icon className="h-3.5 w-3.5" />
        <span>{item.workflow_type}</span>
      </span>
      <span className="text-muted-foreground">|</span>
      <span className="text-foreground/90">{displayParts.join(" — ")}</span>
      {item.act_date && (
        <>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground text-xs">{item.act_date}</span>
        </>
      )}
    </button>
  );
});

export function EstadosTicker() {
  const navigate = useNavigate();
  const { showTicker, isLoading: settingsLoading } = useTickerSettings();
  const { data: items, isLoading: itemsLoading } = useTickerEstados();

  // Duplicate items for seamless infinite scroll - memoized before any returns
  const duplicatedItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [...items, ...items];
  }, [items]);

  // Calculate animation duration based on number of items
  // More items = longer duration for comfortable reading
  const animationDuration = useMemo(() => {
    if (!items) return 30;
    return Math.max(items.length * 4, 30); // Min 30s
  }, [items]);

  // Don't render if disabled or loading settings
  if (settingsLoading || !showTicker) {
    return null;
  }

  // Don't render if no items
  if (!items || items.length === 0) {
    return null;
  }

  const handleItemClick = (workItemId: string) => {
    navigate(`/work-items/${workItemId}`);
  };

  return (
    <div 
      className={cn(
        "w-full bg-card border-b border-border overflow-hidden",
        "relative z-40"
      )}
      role="marquee"
      aria-label="Actualizaciones judiciales recientes"
    >
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3 bg-gradient-to-r from-card via-card to-transparent">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
          <Radio className="h-3 w-3 animate-pulse" />
          <span className="hidden sm:inline">EN VIVO</span>
        </div>
      </div>

      {/* Scrolling container */}
      <div 
        className="flex items-center py-1.5 pl-16 sm:pl-20 ticker-scroll"
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
