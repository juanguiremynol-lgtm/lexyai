/**
 * Invite Accept Page
 * 
 * Handles the secure token-based invite acceptance flow.
 * Users are redirected here from their email invite link.
 */

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, LogIn, Building2 } from "lucide-react";
import { toast } from "sonner";
import { logInviteEvent } from "@/lib/audit-log";

type InviteStatus = "loading" | "valid" | "expired" | "revoked" | "invalid" | "already_member" | "accepted" | "auth_required";

interface InviteDetails {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  email: string;
  expires_at: string;
}

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function InviteAccept() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<InviteStatus>("loading");
  const [inviteDetails, setInviteDetails] = useState<InviteDetails | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    validateInvite();
  }, [token]);

  const validateInvite = async () => {
    try {
      if (!token) {
        setStatus("invalid");
        return;
      }

      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      
      // Hash the token to compare with stored hash
      const tokenHash = await hashToken(token);

      // Find the invite by token hash
      const { data: invite, error } = await supabase
        .from("organization_invites")
        .select(`
          id,
          organization_id,
          email,
          role,
          status,
          expires_at,
          organizations!inner(name)
        `)
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (error || !invite) {
        setStatus("invalid");
        return;
      }

      // Check invite status
      if (invite.status === "REVOKED") {
        setStatus("revoked");
        return;
      }

      if (invite.status === "ACCEPTED") {
        setStatus("already_member");
        return;
      }

      // Check if expired
      if (new Date(invite.expires_at) < new Date()) {
        setStatus("expired");
        return;
      }

      // Set invite details
      setInviteDetails({
        id: invite.id,
        organization_id: invite.organization_id,
        organization_name: (invite.organizations as any)?.name || "Organización",
        role: invite.role,
        email: invite.email,
        expires_at: invite.expires_at,
      });

      // Check if user needs to authenticate
      if (!user) {
        setStatus("auth_required");
        return;
      }

      // Check if already a member
      const { data: existingMembership } = await supabase
        .from("organization_memberships")
        .select("id")
        .eq("organization_id", invite.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingMembership) {
        setStatus("already_member");
        return;
      }

      setStatus("valid");
    } catch (err) {
      console.error("Error validating invite:", err);
      setStatus("invalid");
    }
  };

  const handleAcceptInvite = async () => {
    if (!inviteDetails || !token) return;

    setIsAccepting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStatus("auth_required");
        return;
      }

      // Hash token again for verification
      const tokenHash = await hashToken(token);

      // Double-check the invite is still valid
      const { data: invite, error: checkError } = await supabase
        .from("organization_invites")
        .select("id, status, expires_at")
        .eq("token_hash", tokenHash)
        .eq("status", "PENDING")
        .maybeSingle();

      if (checkError || !invite || new Date(invite.expires_at) < new Date()) {
        setStatus("expired");
        return;
      }

      // Create membership
      const { error: membershipError } = await supabase
        .from("organization_memberships")
        .insert({
          organization_id: inviteDetails.organization_id,
          user_id: user.id,
          role: inviteDetails.role,
        });

      if (membershipError) {
        // Check if it's a duplicate key error (already a member)
        if (membershipError.code === "23505") {
          setStatus("already_member");
          return;
        }
        throw membershipError;
      }

      // Update user's profile with organization_id
      await supabase
        .from("profiles")
        .update({ organization_id: inviteDetails.organization_id })
        .eq("id", user.id);

      // Mark invite as accepted
      await supabase
        .from("organization_invites")
        .update({
          status: "ACCEPTED",
          accepted_at: new Date().toISOString(),
          accepted_by: user.id,
        })
        .eq("id", inviteDetails.id);

      // Log audit event
      await logInviteEvent(inviteDetails.organization_id, inviteDetails.id, "INVITE_ACCEPTED", {
        email: inviteDetails.email,
        role: inviteDetails.role,
        accepted_by: user.id,
      });

      setStatus("accepted");
      toast.success(`¡Te has unido a ${inviteDetails.organization_name}!`);

      // Redirect to dashboard after a short delay
      setTimeout(() => {
        navigate("/dashboard");
      }, 2000);
    } catch (err) {
      console.error("Error accepting invite:", err);
      toast.error("Error al aceptar la invitación");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleLoginRedirect = () => {
    // Store the current URL to return after login
    const returnUrl = window.location.pathname + window.location.search;
    localStorage.setItem("invite_return_url", returnUrl);
    navigate("/auth");
  };

  const renderContent = () => {
    switch (status) {
      case "loading":
        return (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Validando invitación...</p>
          </div>
        );

      case "valid":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">
                Has sido invitado a {inviteDetails?.organization_name}
              </h2>
              <p className="text-muted-foreground">
                Rol: <span className="font-medium">{inviteDetails?.role === "ADMIN" ? "Administrador" : "Miembro"}</span>
              </p>
            </div>
            <Button
              size="lg"
              onClick={handleAcceptInvite}
              disabled={isAccepting}
              className="w-full max-w-xs"
            >
              {isAccepting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Aceptando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Aceptar Invitación
                </>
              )}
            </Button>
          </div>
        );

      case "auth_required":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <LogIn className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Inicia sesión para continuar</h2>
              <p className="text-muted-foreground">
                Para unirte a <span className="font-medium">{inviteDetails?.organization_name}</span>, 
                primero debes iniciar sesión o crear una cuenta.
              </p>
            </div>
            <Button size="lg" onClick={handleLoginRedirect} className="w-full max-w-xs">
              <LogIn className="h-4 w-4 mr-2" />
              Ir a Iniciar Sesión
            </Button>
          </div>
        );

      case "accepted":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">¡Bienvenido!</h2>
              <p className="text-muted-foreground">
                Te has unido exitosamente a {inviteDetails?.organization_name}.
              </p>
              <p className="text-sm text-muted-foreground">
                Redirigiendo al dashboard...
              </p>
            </div>
          </div>
        );

      case "already_member":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Ya eres miembro</h2>
              <p className="text-muted-foreground">
                Ya formas parte de esta organización.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              Ir al Dashboard
            </Button>
          </div>
        );

      case "expired":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Invitación Expirada</h2>
              <p className="text-muted-foreground">
                Esta invitación ha expirado. Solicita una nueva invitación al administrador de la organización.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/")}>
              Ir al Inicio
            </Button>
          </div>
        );

      case "revoked":
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Invitación Revocada</h2>
              <p className="text-muted-foreground">
                Esta invitación ha sido revocada por el administrador.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/")}>
              Ir al Inicio
            </Button>
          </div>
        );

      case "invalid":
      default:
        return (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold">Invitación Inválida</h2>
              <p className="text-muted-foreground">
                El enlace de invitación no es válido o ya ha sido utilizado.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/")}>
              Ir al Inicio
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Invitación a Andromeda</CardTitle>
          <CardDescription>
            Sistema de Gestión Legal
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
