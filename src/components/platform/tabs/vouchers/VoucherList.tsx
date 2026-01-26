/**
 * List of platform courtesy vouchers with actions
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Ticket, XCircle, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { VoucherDetailsDrawer } from "./VoucherDetailsDrawer";

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

export function VoucherList() {
  const queryClient = useQueryClient();
  const [selectedVoucher, setSelectedVoucher] = useState<PlatformVoucher | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fetch vouchers
  const { data: vouchers, isLoading } = useQuery({
    queryKey: ["platform-courtesy-vouchers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_vouchers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as PlatformVoucher[];
    },
  });

  // Revoke mutation
  const revokeVoucher = useMutation({
    mutationFn: async (voucherId: string) => {
      const { data, error } = await supabase.rpc("platform_revoke_voucher", {
        p_voucher_id: voucherId,
        p_reason: "Revocado manualmente desde consola",
      });

      if (error) throw error;
      
      const result = data as unknown as { ok: boolean; error?: string };
      if (!result.ok) {
        throw new Error(result.error || "Error al revocar");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-courtesy-vouchers"] });
      toast.success("Voucher revocado exitosamente");
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Activo</Badge>;
      case "REDEEMED":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Canjeado</Badge>;
      case "REVOKED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Revocado</Badge>;
      case "EXPIRED":
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400">Expirado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "COURTESY":
        return "Cortesía";
      default:
        return type;
    }
  };

  const handleViewDetails = (voucher: PlatformVoucher) => {
    setSelectedVoucher(voucher);
    setDrawerOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando vouchers...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            Vouchers de Cortesía
          </CardTitle>
          <CardDescription>
            {vouchers?.length || 0} vouchers en el sistema
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vouchers && vouchers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Expira</TableHead>
                  <TableHead>Canjeado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell>
                      <code className="text-sm font-mono">{voucher.code}</code>
                    </TableCell>
                    <TableCell>{getTypeLabel(voucher.voucher_type)}</TableCell>
                    <TableCell className="text-sm">{voucher.recipient_email}</TableCell>
                    <TableCell>{getStatusBadge(voucher.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {voucher.expires_at
                        ? format(new Date(voucher.expires_at), "dd MMM yyyy", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {voucher.redeemed_at
                        ? format(new Date(voucher.redeemed_at), "dd MMM yyyy", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetails(voucher)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        {voucher.status === "ACTIVE" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive">
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revocar Voucher</AlertDialogTitle>
                                <AlertDialogDescription>
                                  El voucher <strong>{voucher.code}</strong> ya no podrá ser utilizado.
                                  Esta acción no puede deshacerse.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => revokeVoucher.mutate(voucher.id)}
                                  className="bg-destructive hover:bg-destructive/90"
                                >
                                  Revocar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No hay vouchers de cortesía creados
            </p>
          )}
        </CardContent>
      </Card>

      <VoucherDetailsDrawer
        voucher={selectedVoucher}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
