import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const { refetch } = useSubscription();
  const [isProcessing, setIsProcessing] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const processPayment = async () => {
      try {
        const sessionId = searchParams.get('session_id');
        if (!sessionId) {
          toast.error('Sesión de pago no encontrada');
          navigate('/pricing');
          return;
        }

        // Complete the checkout via edge function (triggers verification)
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')}/functions/v1/billing-complete-checkout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
            body: JSON.stringify({ session_id: sessionId }),
          }
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Error al procesar pago');
        }

        setIsSuccess(true);
        toast.success('¡Pago procesado con éxito!');
        
        // Refetch subscription to get updated status
        await refetch();

        // Redirect after 3 seconds
        setTimeout(() => {
          navigate('/dashboard');
        }, 3000);
      } catch (error) {
        console.error('Payment processing error:', error);
        toast.error((error as Error).message || 'Error al procesar pago');
        setIsProcessing(false);
      }
    };

    processPayment();
  }, [searchParams, navigate, refetch]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/50">
      <div className="bg-card rounded-lg shadow-lg p-8 max-w-md w-full space-y-6">
        {isProcessing && !isSuccess ? (
          <>
            <div className="flex justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">Procesando tu pago...</h1>
              <p className="text-muted-foreground">
                Por favor espera mientras verificamos tu pago y activamos tu plan.
              </p>
            </div>
          </>
        ) : isSuccess ? (
          <>
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">¡Pago confirmado!</h1>
              <p className="text-muted-foreground">
                Tu plan ha sido activado. Serás redirigido al dashboard.
              </p>
            </div>
            <Button 
              className="w-full" 
              onClick={() => navigate('/dashboard')}
            >
              Ir al dashboard
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
