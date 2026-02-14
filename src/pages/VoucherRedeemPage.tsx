/**
 * Voucher Redemption Page
 * Public route for redeeming courtesy vouchers
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Gift,
  CheckCircle2,
  XCircle,
  Loader2,
  LogIn,
  Building2,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import andromedaLogo from "@/assets/andromeda-logo.png";

interface RedeemResult {
  ok: boolean;
  org_id?: string;
  plan_code?: string;
  comped_until_at?: string;
  error?: string;
  code?: string;
}

interface Organization {
  id: string;
  name: string;
}

export default function VoucherRedeemPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [redeemSuccess, setRedeemSuccess] = useState<RedeemResult | null>(null);

  // Check authentication
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["auth-session-redeem"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    },
  });

  // Fetch user's organizations
  const { data: userOrgs, isLoading: orgsLoading } = useQuery({
    queryKey: ["user-orgs-redeem"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("organization_memberships")
        .select("organization_id, organizations(id, name)")
        .eq("user_id", user.id);

      if (error) throw error;

      return data?.map((m) => ({
        id: (m.organizations as unknown as Organization).id,
        name: (m.organizations as unknown as Organization).name,
      })) || [];
    },
    enabled: !!session,
  });

  // Set default org when loaded
  useEffect(() => {
    if (userOrgs && userOrgs.length > 0 && !selectedOrgId) {
      setSelectedOrgId(userOrgs[0].id);
    }
  }, [userOrgs, selectedOrgId]);

  // Redeem mutation
  const redeemVoucher = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Token no válido");

      const { data, error } = await supabase.rpc("platform_redeem_voucher", {
        p_raw_token: token,
        p_target_org_id: selectedOrgId || null,
      });

      if (error) throw error;
      return data as unknown as RedeemResult;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setRedeemSuccess(data);
        toast.success("¡Voucher canjeado exitosamente!");
      } else {
        toast.error(data.error || "Error al canjear voucher");
      }
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleLogin = () => {
    // Store token in sessionStorage to resume after login
    if (token) {
      sessionStorage.setItem("pending_voucher_token", token);
    }
    navigate("/auth");
  };

  const handleGoToDashboard = () => {
    navigate("/");
  };

  const handleGoToBilling = () => {
    navigate("/settings?tab=billing");
  };

  // Check for pending voucher after login
  useEffect(() => {
    if (session) {
      const pendingToken = sessionStorage.getItem("pending_voucher_token");
      if (pendingToken && pendingToken !== token) {
        // Clear and redirect to the correct URL
        sessionStorage.removeItem("pending_voucher_token");
        navigate(`/v/redeem/${pendingToken}`);
      }
    }
  }, [session, token, navigate]);

  // Loading state
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated - show login prompt
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <img src={andromedaLogo} alt="Andromeda" className="h-12 mx-auto" />
            </div>
            <CardTitle className="flex items-center justify-center gap-2">
              <Gift className="h-6 w-6 text-primary" />
              Canjear Voucher
            </CardTitle>
            <CardDescription>
              Inicie sesión para canjear su voucher de cortesía
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <LogIn className="h-4 w-4" />
              <AlertTitle>Autenticación requerida</AlertTitle>
              <AlertDescription>
                Debe iniciar sesión o crear una cuenta para canjear este voucher.
              </AlertDescription>
            </Alert>

            <Button onClick={handleLogin} className="w-full gap-2">
              <LogIn className="h-4 w-4" />
              Iniciar Sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (redeemSuccess?.ok) {
    const compedUntil = redeemSuccess.comped_until_at
      ? format(new Date(redeemSuccess.comped_until_at), "dd 'de' MMMM 'de' yyyy", { locale: es })
      : "—";

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>¡Voucher Canjeado!</CardTitle>
            <CardDescription>
              Su cuenta ha sido actualizada exitosamente
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-amber-500" />
                <span className="font-medium">Plan Enterprise</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Acceso completo habilitado hasta: <strong>{compedUntil}</strong>
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={handleGoToDashboard} className="w-full">
                Ir al Dashboard
              </Button>
              <Button onClick={handleGoToBilling} variant="outline" className="w-full">
                Ver Detalles de Facturación
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error from redemption attempt
  if (redeemVoucher.data && !redeemVoucher.data.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle>Error al Canjear</CardTitle>
            <CardDescription>
              No fue posible canjear el voucher
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {redeemVoucher.data.error || "Error desconocido"}
              </AlertDescription>
            </Alert>

            <Button onClick={handleGoToDashboard} variant="outline" className="w-full">
              Volver al Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main redemption form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src={andromedaLogo} alt="Andromeda" className="h-12 mx-auto" />
          </div>
          <CardTitle className="flex items-center justify-center gap-2">
            <Gift className="h-6 w-6 text-primary" />
            Canjear Voucher de Cortesía
          </CardTitle>
          <CardDescription>
            Obtenga acceso Enterprise por 1 año sin costo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Benefits */}
          <div className="rounded-lg border p-4 space-y-2 bg-muted/50">
            <div className="flex items-center gap-2 font-medium">
              <Crown className="h-5 w-5 text-amber-500" />
              Plan Enterprise
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 ml-7">
              <li>• Acceso multiusuario</li>
              <li>• Consola de administración</li>
              <li>• Soporte prioritario</li>
              <li>• 1 año de acceso completo</li>
            </ul>
          </div>

          {/* Organization selector (if multiple) */}
          {orgsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : userOrgs && userOrgs.length > 1 ? (
            <div className="space-y-2">
              <Label>Seleccione la organización</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar organización" />
                </SelectTrigger>
                <SelectContent>
                  {userOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {org.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : userOrgs && userOrgs.length === 1 ? (
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Organización: <strong>{userOrgs[0].name}</strong></span>
            </div>
          ) : (
            <Alert>
              <Building2 className="h-4 w-4" />
              <AlertDescription>
                Se creará una nueva organización para usted automáticamente.
              </AlertDescription>
            </Alert>
          )}

          {/* Redeem button */}
          <Button
            onClick={() => redeemVoucher.mutate()}
            disabled={redeemVoucher.isPending}
            className="w-full gap-2"
            size="lg"
          >
            {redeemVoucher.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Canjear Voucher
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Al canjear, acepta los términos y condiciones de ATENIA
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
