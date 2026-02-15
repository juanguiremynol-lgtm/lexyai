/**
 * GhostVerificationBadge — Shows ghost verification classification status
 */

import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, ShieldAlert, HelpCircle, Clock } from "lucide-react";

interface Props {
  status: string | null | undefined;
}

export function GhostVerificationBadge({ status }: Props) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
        <Clock className="h-3 w-3" />
        Sin verificar
      </Badge>
    );
  }

  switch (status) {
    case "SYSTEM_ISSUE":
      return (
        <Badge variant="destructive" className="text-xs gap-1">
          <ShieldAlert className="h-3 w-3" />
          Problema Sistema
        </Badge>
      );
    case "ITEM_SPECIFIC":
      return (
        <Badge className="text-xs gap-1 bg-yellow-500/10 text-yellow-700 border-yellow-300">
          <AlertTriangle className="h-3 w-3" />
          Específico del Item
        </Badge>
      );
    case "RESOLVED":
      return (
        <Badge className="text-xs gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Resuelto
        </Badge>
      );
    case "INCONCLUSIVE":
      return (
        <Badge variant="outline" className="text-xs gap-1">
          <HelpCircle className="h-3 w-3" />
          Inconcluso
        </Badge>
      );
    case "PENDING":
      return (
        <Badge variant="outline" className="text-xs gap-1">
          <Clock className="h-3 w-3 animate-pulse" />
          Verificando...
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs">
          {status}
        </Badge>
      );
  }
}
