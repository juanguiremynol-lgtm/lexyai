import { AlertTriangle, Calendar, Zap, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionGate } from '@/hooks/use-subscription-gate';
import { useNavigate } from 'react-router-dom';

export function SubscriptionBanner() {
  const { bannerType, statusMessage, daysLeft, isExpired, isSuspended } = useSubscriptionGate();
  const navigate = useNavigate();

  // Don't show banner if not needed
  if (!bannerType) {
    return null;
  }

  const isUrgent = isExpired || isSuspended || (bannerType === 'trial' && daysLeft <= 3);

  const getIcon = () => {
    switch (bannerType) {
      case 'expired':
        return <XCircle className="h-4 w-4 flex-shrink-0" />;
      case 'suspended':
        return <AlertTriangle className="h-4 w-4 flex-shrink-0" />;
      case 'trial':
        return <Calendar className="h-4 w-4 flex-shrink-0" />;
      default:
        return <AlertTriangle className="h-4 w-4 flex-shrink-0" />;
    }
  };

  const getButtonText = () => {
    if (isExpired) return 'Reactivar';
    if (isSuspended) return 'Resolver';
    return 'Ver planes';
  };

  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-2 text-sm ${
      isUrgent 
        ? 'bg-destructive/10 text-destructive border-b border-destructive/20' 
        : 'bg-yellow-50 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-200 border-b border-yellow-200 dark:border-yellow-800'
    }`}>
      <div className="flex items-center gap-2">
        {getIcon()}
        <span>{statusMessage}</span>
      </div>
      <Button
        size="sm"
        variant={isUrgent ? 'default' : 'outline'}
        onClick={() => navigate('/pricing')}
        className="flex-shrink-0"
      >
        <Zap className="h-3 w-3 mr-1" />
        {getButtonText()}
      </Button>
    </div>
  );
}
