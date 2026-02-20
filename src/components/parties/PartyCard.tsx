/**
 * PartyCard — Displays a single party with completeness warnings
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Building2, Star, AlertTriangle, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { type WorkItemParty, getPartyDisplayName, getPartyWarnings, calculatePartyCompleteness } from "@/lib/party-utils";

interface PartyCardProps {
  party: WorkItemParty;
  onEdit: () => void;
  onDelete: () => void;
}

export function PartyCard({ party, onEdit, onDelete }: PartyCardProps) {
  const displayName = getPartyDisplayName(party);
  const warnings = getPartyWarnings(party);
  const completeness = calculatePartyCompleteness(party);
  const isComplete = completeness.missing.length === 0;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-card hover:bg-muted/20 transition-colors group">
      {/* Left: icon + star */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        {party.is_our_client && (
          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
        )}
        {party.party_type === "juridica" ? (
          <Building2 className="h-4 w-4 text-muted-foreground" />
        ) : (
          <User className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Center: info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{displayName}</span>
          {party.is_our_client && (
            <Badge variant="outline" className="text-[10px] h-4 border-amber-500/50 text-amber-600">
              Nuestro cliente
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px] h-4">
            {party.party_type === "juridica" ? "Sociedad" : "Persona"}
          </Badge>
        </div>

        {/* Identification */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          {party.party_type === "natural" ? (
            <>
              {party.cedula && <span>C.C. {party.cedula}</span>}
              {party.email && <span className="ml-2">· {party.email}</span>}
              {party.phone && <span className="ml-2">· {party.phone}</span>}
            </>
          ) : (
            <>
              {party.company_nit && <span>NIT {party.company_nit}</span>}
              {party.rep_legal_name && (
                <div>Rep. Legal: {party.rep_legal_name}</div>
              )}
            </>
          )}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-0.5">
            {warnings.slice(0, 2).map((w, i) => (
              <div key={i} className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
            {warnings.length > 2 && (
              <span className="text-xs text-amber-600">+{warnings.length - 2} más</span>
            )}
          </div>
        )}

        {isComplete && party.is_our_client && (
          <div className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            <span>Completo</span>
          </div>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
