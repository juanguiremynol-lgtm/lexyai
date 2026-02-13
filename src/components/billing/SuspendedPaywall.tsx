/**
 * SuspendedPaywall — Full-screen blocking overlay when account is suspended
 * 
 * Shows when subscription is suspended (past grace period).
 * Allows payment to immediately reactivate.
 * Super admins are exempt.
 */

import { ShieldX, CreditCard, Phone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRenewalStatus } from '@/hooks/use-renewal-status';
import { useCreateCheckoutSessionV2 } from '@/lib/billing/hooks';
import { useOrganization } from '@/contexts/OrganizationContext';
import { formatCOP } from '@/lib/billing/pricing-windows';
import type { PlanCode } from '@/types/billing';

export function SuspendedPaywall() {
  const status = useRenewalStatus();
  const createCheckout = useCreateCheckoutSessionV2();
  const { organization } = useOrganization();

  if (!status.showPaywall) return null;

  const handlePayNow = () => {
    if (!organization?.id || !status.planCode) return;
    createCheckout.mutate({
      organizationId: organization.id,
      planCode: status.planCode as PlanCode,
      billingCycleMonths: status.billingCycleMonths as 1 | 24,
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <Card className="w-full max-w-md mx-4 shadow-2xl border-destructive/30">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-xl">Cuenta Suspendida</CardTitle>
          <CardDescription className="text-base">
            Tu cuenta ha sido suspendida por falta de pago. 
            Realiza el pago para reactivar el servicio inmediatamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Amount summary */}
          {status.amountCop > 0 && (
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Monto pendiente</p>
              <p className="text-2xl font-bold">{formatCOP(status.amountCop)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                IVA incluido · Plan {status.planCode}
              </p>
            </div>
          )}

          {status.canPay ? (
            <Button 
              className="w-full gap-2" 
              size="lg" 
              onClick={handlePayNow}
              disabled={createCheckout.isPending}
            >
              <CreditCard className="h-5 w-5" />
              {createCheckout.isPending ? 'Preparando pago...' : 'Pagar y Reactivar'}
            </Button>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Solo el administrador de tu organización puede realizar el pago.
              </p>
              <p className="text-sm font-medium">
                Contacta al administrador para reactivar el servicio.
              </p>
            </div>
          )}

          {/* Support contact */}
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground text-center mb-2">
              ¿Necesitas ayuda?
            </p>
            <div className="flex justify-center gap-4 text-xs text-muted-foreground">
              <a href="mailto:soporte@atenia.co" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Mail className="h-3 w-3" />
                soporte@atenia.co
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
