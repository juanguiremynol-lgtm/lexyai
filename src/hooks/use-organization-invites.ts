/**
 * Hook for managing organization invites
 * Provides CRUD operations for inviting users to organizations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logInviteEvent } from "@/lib/audit-log";

export interface OrganizationInvite {
  id: string;
  organization_id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  invited_by: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

interface CreateInviteParams {
  email: string;
  role: "ADMIN" | "MEMBER";
}

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

export function useOrganizationInvites(organizationId: string | null) {
  const queryClient = useQueryClient();

  // Fetch invites for the organization
  const {
    data: invites = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["organization-invites", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("organization_invites")
        .select("*")
        .eq("organization_id", organizationId)
        .in("status", ["PENDING", "ACCEPTED"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as OrganizationInvite[];
    },
    enabled: !!organizationId,
  });

  // Create a new invite
  const createInvite = useMutation({
    mutationFn: async ({ email, role }: CreateInviteParams) => {
      if (!organizationId) throw new Error("No organization selected");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Check for existing pending invite
      const { data: existing } = await supabase
        .from("organization_invites")
        .select("id")
        .eq("organization_id", organizationId)
        .ilike("email", email.toLowerCase().trim())
        .eq("status", "PENDING")
        .maybeSingle();

      if (existing) {
        throw new Error("Ya existe una invitación pendiente para este email");
      }

      // Check if user is already a member
      const { data: existingMember } = await supabase
        .from("organization_memberships")
        .select("id, user_id")
        .eq("organization_id", organizationId)
        .limit(100);

      // We can't directly query by email in memberships, so we check profiles
      if (existingMember && existingMember.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id")
          .in("id", existingMember.map(m => m.user_id));
        
        // Get auth users to check email - this is a limitation, we'll rely on the invite accept flow to check
      }

      // Generate token
      const token = generateToken();
      const tokenHash = await hashToken(token);
      
      // Set expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data: invite, error } = await supabase
        .from("organization_invites")
        .insert({
          organization_id: organizationId,
          email: email.toLowerCase().trim(),
          role,
          invited_by: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt.toISOString(),
          status: "PENDING",
        })
        .select()
        .single();

      if (error) throw error;

      // Queue email to be sent
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .single();

      const inviteUrl = `https://andromeda.legal/invite/accept?token=${token}`;
      
      await supabase.from("email_outbox").insert({
        organization_id: organizationId,
        to_email: email.toLowerCase().trim(),
        subject: `Invitación a unirte a ${org?.name || "la organización"} en Andromeda`,
        html: `
          <h1>¡Has sido invitado!</h1>
          <p>Has recibido una invitación para unirte a <strong>${org?.name || "una organización"}</strong> en Andromeda como <strong>${role === "ADMIN" ? "Administrador" : "Miembro"}</strong>.</p>
          <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0ea5e9; color: white; text-decoration: none; border-radius: 6px;">Aceptar Invitación</a></p>
          <p>Este enlace expira en 7 días.</p>
          <p>Si no esperabas esta invitación, puedes ignorar este correo.</p>
        `,
        status: "PENDING",
      });

      // Log audit event
      await logInviteEvent(organizationId, invite.id, "INVITE_SENT", {
        email: email.toLowerCase().trim(),
        role,
      });

      return { invite, token };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["organization-invites", organizationId] });
      toast.success(`Invitación enviada a ${variables.email}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al enviar la invitación");
    },
  });

  // Resend an invite
  const resendInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      if (!organizationId) throw new Error("No organization selected");

      // Get the existing invite
      const { data: invite, error: fetchError } = await supabase
        .from("organization_invites")
        .select("*")
        .eq("id", inviteId)
        .single();

      if (fetchError) throw fetchError;
      if (invite.status !== "PENDING") {
        throw new Error("Solo se pueden reenviar invitaciones pendientes");
      }

      // Generate new token
      const token = generateToken();
      const tokenHash = await hashToken(token);
      
      // Extend expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error: updateError } = await supabase
        .from("organization_invites")
        .update({
          token_hash: tokenHash,
          expires_at: expiresAt.toISOString(),
        })
        .eq("id", inviteId);

      if (updateError) throw updateError;

      // Queue new email
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .single();

      const inviteUrl = `https://andromeda.legal/invite/accept?token=${token}`;
      
      await supabase.from("email_outbox").insert({
        organization_id: organizationId,
        to_email: invite.email,
        subject: `Recordatorio: Invitación a unirte a ${org?.name || "la organización"} en Andromeda`,
        html: `
          <h1>Recordatorio de Invitación</h1>
          <p>Este es un recordatorio de que has sido invitado a unirte a <strong>${org?.name || "una organización"}</strong> en Andromeda como <strong>${invite.role === "ADMIN" ? "Administrador" : "Miembro"}</strong>.</p>
          <p><a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0ea5e9; color: white; text-decoration: none; border-radius: 6px;">Aceptar Invitación</a></p>
          <p>Este enlace expira en 7 días.</p>
        `,
        status: "PENDING",
      });

      // Log audit event
      await logInviteEvent(organizationId, inviteId, "INVITE_RESENT", {
        email: invite.email,
      });

      return { invite, token };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-invites", organizationId] });
      toast.success("Invitación reenviada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al reenviar la invitación");
    },
  });

  // Revoke an invite
  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      if (!organizationId) throw new Error("No organization selected");

      const { error } = await supabase
        .from("organization_invites")
        .update({ status: "REVOKED" })
        .eq("id", inviteId)
        .eq("status", "PENDING");

      if (error) throw error;

      // Log audit event
      await logInviteEvent(organizationId, inviteId, "INVITE_REVOKED", {});

      return inviteId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-invites", organizationId] });
      toast.success("Invitación revocada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al revocar la invitación");
    },
  });

  return {
    invites,
    isLoading,
    error,
    createInvite,
    resendInvite,
    revokeInvite,
    pendingInvites: invites.filter((i) => i.status === "PENDING"),
  };
}
