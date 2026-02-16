import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCOP, type SubscriptionPlan, type PlanName, PLAN_COLORS } from '@/lib/subscription-constants';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Check, Crown, Sparkles, Star, Users, Zap, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';

const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') + '/functions/v1';

interface PricingCardProps {
  plan: SubscriptionPlan;
  isCurrentPlan: boolean;
  onSelect: (plan: SubscriptionPlan) => Promise<void>;
  recommended?: boolean;
  isLoading?: boolean;
}

const PLAN_ICONS: Record<PlanName, React.ReactNode> = {
  trial: <Sparkles className="h-6 w-6" />,
  basic: <Star className="h-6 w-6" />,
  standard: <Zap className="h-6 w-6" />,
  business: <Users className="h-6 w-6" />,
  unlimited: <Crown className="h-6 w-6" />,
};

export function PricingCard({ plan, isCurrentPlan, onSelect, recommended, isLoading }: PricingCardProps) {
  const planName = plan.name as PlanName;
  const icon = PLAN_ICONS[planName] || <Star className="h-6 w-6" />;
  
  return (
    <Card className={cn(
      'relative flex flex-col transition-all duration-200',
      recommended && 'border-primary shadow-lg ring-2 ring-primary/20',
      isCurrentPlan && 'bg-primary/5'
    )}>
      {recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground">
            Recomendado
          </Badge>
        </div>
      )}
      
      <CardHeader className="text-center pb-2">
        <div className={cn(
          'mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-2',
          planName === 'unlimited' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300' :
          planName === 'standard' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300' :
          planName === 'basic' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300' :
          'bg-muted text-muted-foreground'
        )}>
          {icon}
        </div>
        <CardTitle className="text-xl">{plan.display_name}</CardTitle>
        <CardDescription>
          {plan.name === 'trial' ? 'Prueba gratuita por 3 meses' :
           plan.name === 'unlimited' ? 'Sin límites' :
           `Hasta ${plan.max_clients} clientes`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        <div className="text-center">
          <span className="text-3xl font-bold">
            {plan.price_cop === 0 ? 'Gratis' : formatCOP(plan.price_cop)}
          </span>
          {plan.price_cop > 0 && (
            <span className="text-muted-foreground">/mes</span>
          )}
        </div>

        <ul className="space-y-2">
          {(plan.features as string[]).map((feature, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {plan.max_clients && plan.max_filings && (
          <div className="pt-2 border-t text-sm text-muted-foreground space-y-1">
            <p>• Máximo {plan.max_clients} clientes</p>
            <p>• Máximo {plan.max_filings} procesos</p>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          onClick={() => onSelect(plan)}
          className="w-full"
          variant={isCurrentPlan ? 'outline' : recommended ? 'default' : 'outline'}
          disabled={isCurrentPlan || isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Procesando...
            </>
          ) : isCurrentPlan ? 'Plan actual' : 
            plan.name === 'trial' ? 'Iniciar prueba' :
            'Seleccionar plan'}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function PricingCards() {
  const { plans, plan: currentPlan, isLoading: subLoading } = useSubscription();
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (!organization?.id) {
      toast.error('Por favor inicia sesión para continuar');
      return;
    }

    if (plan.price_cop === 0) {
      // Free plan — no checkout needed
      toast.success('Plan gratuito activado');
      return;
    }

    setIsLoading(true);
    try {
      // Create checkout session via edge function
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      if (!token) {
        toast.error('Por favor inicia sesión para continuar');
        return;
      }

      const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/billing-create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          organization_id: organization.id,
          plan_code: plan.name === 'trial' ? 'FREE_TRIAL' : 
                   plan.name === 'basic' ? 'BASIC' :
                   plan.name === 'standard' ? 'PRO' : 'ENTERPRISE',
          billing_cycle_months: 1,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error al crear sesión de pago');
      }

      // For demo mode, show mock payment page; for real Wompi, redirect to checkout_url
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else if (data.session_id) {
        // Redirect to our mock checkout page
        navigate(`/checkout?session_id=${data.session_id}`);
      }
    } catch (error) {
      toast.error((error as Error).message || 'Error al procesar pago');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter out trial from pricing display for non-trial users
  const displayPlans = plans.filter(p => 
    p.name !== 'trial' || currentPlan?.name === 'trial'
  );

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {displayPlans.map((plan) => (
        <PricingCard
          key={plan.id}
          plan={plan}
          isCurrentPlan={currentPlan?.id === plan.id}
          onSelect={handleSelectPlan}
          recommended={plan.name === 'standard'}
          isLoading={isLoading || subLoading}
        />
      ))}
    </div>
  );
}
