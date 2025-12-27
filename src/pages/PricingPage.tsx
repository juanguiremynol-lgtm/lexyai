import { PricingCards } from '@/components/subscription';
import { SubscriptionStatusCard } from '@/components/subscription';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useEffect } from 'react';

export default function PricingPage() {
  const { subscription, isLoading } = useSubscription();

  useEffect(() => {
    document.title = 'Planes y Precios - ATENIA';
  }, []);

  return (
    <div className="container max-w-7xl py-8 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Planes y Precios</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Elige el plan que mejor se adapte a las necesidades de tu firma. 
            Todos los planes incluyen acceso completo a ATENIA.
          </p>
        </div>

        {/* Current subscription status */}
        {!isLoading && subscription && (
          <div className="max-w-md mx-auto">
            <SubscriptionStatusCard />
          </div>
        )}

        {/* Pricing cards */}
        <PricingCards />

        {/* FAQ or additional info */}
        <div className="text-center space-y-4 pt-8 border-t">
          <h2 className="text-xl font-semibold">¿Necesitas ayuda para elegir?</h2>
          <p className="text-muted-foreground">
            Contáctanos a <a href="mailto:soporte@atenia.co" className="text-primary hover:underline">soporte@atenia.co</a> y te ayudaremos a encontrar el plan perfecto para tu firma.
          </p>
          <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto text-left pt-4">
            <div className="space-y-2">
              <h3 className="font-medium">Prueba gratuita</h3>
              <p className="text-sm text-muted-foreground">
                3 meses para probar todas las funcionalidades sin compromiso.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Sin contratos</h3>
              <p className="text-sm text-muted-foreground">
                Paga mes a mes. Cancela cuando quieras.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Soporte incluido</h3>
              <p className="text-sm text-muted-foreground">
                Todos los planes incluyen soporte por correo electrónico.
              </p>
            </div>
        </div>
      </div>
    </div>
  );
}
