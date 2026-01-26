/**
 * Drawer showing voucher details and event timeline
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Ticket,
  Calendar,
  Mail,
  Building2,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface PlatformVoucher {
  id: string;
  voucher_type: string;
  code: string;
  recipient_email: string;
  plan_code: string;
  duration_days: number;
  amount_cop_incl_iva: number;
  currency: string;
  status: string;
  expires_at: string | null;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  redeemed_for_org_id: string | null;
  note: string | null;
  created_at: string;
}

interface VoucherEvent {
  id: string;
  voucher_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface VoucherDetailsDrawerProps {
  voucher: PlatformVoucher | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VoucherDetailsDrawer({ voucher, open, onOpenChange }: VoucherDetailsDrawerProps) {
  // Fetch events for this voucher
  const { data: events } = useQuery({
    queryKey: ["platform-voucher-events", voucher?.id],
    queryFn: async () => {
      if (!voucher?.id) return [];
      const { data, error } = await supabase
        .from("platform_voucher_events")
        .select("*")
        .eq("voucher_id", voucher.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as VoucherEvent[];
    },
    enabled: !!voucher?.id && open,
  });

  // Fetch org name if redeemed
  const { data: org } = useQuery({
    queryKey: ["org-name", voucher?.redeemed_for_org_id],
    queryFn: async () => {
      if (!voucher?.redeemed_for_org_id) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", voucher.redeemed_for_org_id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!voucher?.redeemed_for_org_id && open,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-green-100 text-green-800">Activo</Badge>;
      case "REDEEMED":
        return <Badge className="bg-blue-100 text-blue-800">Canjeado</Badge>;
      case "REVOKED":
        return <Badge className="bg-red-100 text-red-800">Revocado</Badge>;
      case "EXPIRED":
        return <Badge className="bg-gray-100 text-gray-800">Expirado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "CREATED":
        return <Ticket className="h-4 w-4 text-primary" />;
      case "REDEEMED":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "REDEEM_ATTEMPT":
        return <AlertTriangle className="h-4 w-4 text-amber-600" />;
      case "REVOKED":
        return <XCircle className="h-4 w-4 text-red-600" />;
      case "EXPIRED":
        return <Clock className="h-4 w-4 text-gray-600" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getEventLabel = (eventType: string) => {
    switch (eventType) {
      case "CREATED":
        return "Voucher creado";
      case "REDEEMED":
        return "Voucher canjeado";
      case "REDEEM_ATTEMPT":
        return "Intento de canje";
      case "REVOKED":
        return "Voucher revocado";
      case "EXPIRED":
        return "Voucher expirado";
      default:
        return eventType;
    }
  };

  if (!voucher) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            {voucher.code}
          </SheetTitle>
          <SheetDescription>
            Voucher de {voucher.voucher_type === "COURTESY" ? "Cortesía" : voucher.voucher_type}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-8rem)] mt-6">
          <div className="space-y-6 pr-4">
            {/* Status Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Estado</h4>
              <div className="flex items-center gap-2">
                {getStatusBadge(voucher.status)}
                <span className="text-sm">
                  Plan {voucher.plan_code} por {voucher.duration_days} días
                </span>
              </div>
            </div>

            <Separator />

            {/* Details Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Detalles</h4>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{voucher.recipient_email}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Creado: {format(new Date(voucher.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </span>
                </div>

                {voucher.expires_at && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Expira: {format(new Date(voucher.expires_at), "dd MMM yyyy HH:mm", { locale: es })}
                    </span>
                  </div>
                )}

                {voucher.redeemed_at && (
                  <>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>
                        Canjeado: {format(new Date(voucher.redeemed_at), "dd MMM yyyy HH:mm", { locale: es })}
                      </span>
                    </div>

                    {org?.name && (
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span>Organización: {org.name}</span>
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Precio:</span>
                  <span className="font-medium">
                    {voucher.amount_cop_incl_iva.toLocaleString("es-CO")} {voucher.currency} (IVA incl.)
                  </span>
                </div>
              </div>

              {voucher.note && (
                <div className="mt-2 p-2 bg-muted rounded text-sm">
                  <span className="text-muted-foreground">Nota:</span> {voucher.note}
                </div>
              )}
            </div>

            <Separator />

            {/* Timeline Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Historial de Eventos</h4>
              
              <div className="space-y-3">
                {events?.map((event) => (
                  <div key={event.id} className="flex gap-3 text-sm">
                    <div className="mt-0.5">{getEventIcon(event.event_type)}</div>
                    <div className="flex-1">
                      <p className="font-medium">{getEventLabel(event.event_type)}</p>
                      <p className="text-muted-foreground text-xs">
                        {format(new Date(event.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                        {event.actor_email && ` • ${event.actor_email}`}
                      </p>
                      {Object.keys(event.metadata).length > 0 && (
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}

                {(!events || events.length === 0) && (
                  <p className="text-sm text-muted-foreground">No hay eventos registrados</p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
