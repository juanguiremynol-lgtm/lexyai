/**
 * Impersonation Context - Read-only support mode for platform admins
 * 
 * When impersonating an organization, the platform admin can view all data
 * as if they were a member of that org, but ALL mutations are blocked.
 */

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { logAudit } from "@/lib/audit-log";
import { toast } from "sonner";

interface ImpersonatedOrg {
  id: string;
  name: string;
}

interface ImpersonationContextType {
  isImpersonating: boolean;
  impersonatedOrg: ImpersonatedOrg | null;
  enterImpersonation: (org: ImpersonatedOrg) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  checkMutationAllowed: () => boolean;
}

const ImpersonationContext = createContext<ImpersonationContextType>({
  isImpersonating: false,
  impersonatedOrg: null,
  enterImpersonation: async () => {},
  exitImpersonation: async () => {},
  checkMutationAllowed: () => true,
});

export function useImpersonation() {
  return useContext(ImpersonationContext);
}

interface ImpersonationProviderProps {
  children: ReactNode;
}

export function ImpersonationProvider({ children }: ImpersonationProviderProps) {
  const [impersonatedOrg, setImpersonatedOrg] = useState<ImpersonatedOrg | null>(null);

  const enterImpersonation = useCallback(async (org: ImpersonatedOrg) => {
    // Log the impersonation start
    await logAudit({
      organizationId: org.id,
      action: "PLATFORM_ORG_IMPERSONATION_STARTED",
      entityType: "organization",
      entityId: org.id,
      metadata: {
        organizationName: org.name,
        supportMode: true,
        readOnly: true,
      },
    });

    setImpersonatedOrg(org);
    toast.info(`Modo Soporte activado para: ${org.name}`, {
      description: "Solo lectura - Las mutaciones están bloqueadas",
      duration: 5000,
    });
  }, []);

  const exitImpersonation = useCallback(async () => {
    if (impersonatedOrg) {
      // Log the impersonation end
      await logAudit({
        organizationId: impersonatedOrg.id,
        action: "PLATFORM_ORG_IMPERSONATION_ENDED",
        entityType: "organization",
        entityId: impersonatedOrg.id,
        metadata: {
          organizationName: impersonatedOrg.name,
        },
      });

      toast.success("Modo Soporte desactivado");
    }

    setImpersonatedOrg(null);
  }, [impersonatedOrg]);

  const checkMutationAllowed = useCallback(() => {
    if (impersonatedOrg) {
      toast.error("Acción bloqueada: Modo Soporte (Solo Lectura)", {
        description: "Salga del modo soporte para realizar cambios.",
      });
      return false;
    }
    return true;
  }, [impersonatedOrg]);

  return (
    <ImpersonationContext.Provider
      value={{
        isImpersonating: !!impersonatedOrg,
        impersonatedOrg,
        enterImpersonation,
        exitImpersonation,
        checkMutationAllowed,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

/**
 * HOC to wrap mutations with impersonation check
 */
export function withImpersonationGuard<T extends (...args: unknown[]) => unknown>(
  mutationFn: T,
  checkFn: () => boolean
): T {
  return ((...args: Parameters<T>) => {
    if (!checkFn()) {
      return Promise.reject(new Error("Mutation blocked: Support Mode active"));
    }
    return mutationFn(...args);
  }) as T;
}
