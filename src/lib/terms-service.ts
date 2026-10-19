/**
 * Terms & Conditions service — handles acceptance, validation, and version checks.
 * 
 * CANONICAL SOURCE: All terms text and hashes come from the DATABASE via get_active_terms().
 * The frontend file terms-text.ts is a DEV-ONLY fallback and must never be used
 * as the compliance source of truth.
 * 
 * HASH POLICY: Hashes are ALWAYS server-computed via pgcrypto + canonicalize_legal_text().
 * The client NEVER computes compliance-critical hashes.
 * 
 * PRIVACY POLICY: Acceptance records include privacy_policy_version and privacy_policy_text_hash.
 * Re-acceptance is required if EITHER the T&C or Privacy Policy version changes.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ActiveTermsData {
  termsVersion: string;
  termsLastUpdated: string;
  termsText: string;
  termsTextHash: string;
  privacyVersion: string;
  privacyText: string;
  privacyTextHash: string;
  operador: {
    razonSocial: string;
    nit: string;
    domicilio: string;
    correo: string;
    correoPrivacidad: string;
    telefono: string;
  };
}

/**
 * Fetch the active terms and privacy policy text from the DB (canonical source).
 * Fails closed if the canonical documents cannot be loaded in full.
 */
export async function fetchActiveTerms(): Promise<ActiveTermsData> {
  try {
    const { data, error } = await supabase.rpc("get_active_terms");
    
    if (error) throw new Error("No se pudieron cargar los documentos legales. Reintenta.");
    if (!data || (Array.isArray(data) && data.length === 0))
      throw new Error("No hay documentos legales vigentes disponibles. Reintenta.");

    const row = Array.isArray(data) ? data[0] : data;
    // A seeded title is not a legal document and must never be accepted.
    if (!isCompleteLegalDocument(row.terms_text) || !isCompleteLegalDocument(row.privacy_text))
      throw new Error("Los documentos legales están incompletos. Reintenta o contacta con soporte.");
    
    return {
      termsVersion: row.terms_version,
      termsLastUpdated: row.terms_last_updated,
      termsText: row.terms_text,
      termsTextHash: row.terms_text_hash,
      privacyVersion: row.privacy_version,
      privacyText: row.privacy_text,
      privacyTextHash: row.privacy_text_hash,
      operador: {
        razonSocial: row.operador_razon_social,
        nit: row.operador_nit,
        domicilio: row.operador_domicilio,
        correo: row.operador_correo,
        correoPrivacidad: row.operador_correo_privacidad,
        telefono: row.operador_telefono,
      },
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error("No se pudieron cargar los documentos legales. Reintenta.");
  }
}

export function isCompleteLegalDocument(text: unknown): text is string {
  return typeof text === "string" && text.trim().split(/\n\s*\n/).filter(Boolean).length > 1;
}

export interface TermsAcceptancePayload {
  checkboxTerms: boolean;
  checkboxAge: boolean;
  checkboxMarketing: boolean;
  acceptanceMethod?: string;
  scrollGated?: boolean;
}

/**
 * Record the user's acceptance of the current terms version.
 * Uses server-derived hashes from the DB — never client-computed hashes.
 */
export async function recordTermsAcceptance(
  payload: TermsAcceptancePayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return { success: false, error: "Usuario no autenticado" };

    // Validate mandatory checkboxes
    if (!payload.checkboxTerms || !payload.checkboxAge) {
      return {
        success: false,
        error: "Debe aceptar los términos obligatorios",
      };
    }

    // Fetch canonical terms data from DB
    const activeTerms = await fetchActiveTerms();
    // Avoid recording a duplicate acceptance for the same current versions.
    if (await hasAcceptedCurrentTerms()) return { success: true };

    const { error } = await supabase.from("terms_acceptance").insert({
      user_id: user.id,
      operador_razon_social: activeTerms.operador.razonSocial,
      operador_nit: activeTerms.operador.nit,
      terms_version: activeTerms.termsVersion,
      terms_last_updated_date: activeTerms.termsLastUpdated,
      terms_text_hash: activeTerms.termsTextHash,
      privacy_policy_version: activeTerms.privacyVersion,
      privacy_policy_text_hash: activeTerms.privacyTextHash,
      acceptance_method: payload.acceptanceMethod || "registration_web",
      user_agent: navigator.userAgent,
      locale: navigator.language || "es-CO",
      checkbox_terms: payload.checkboxTerms,
      checkbox_age: payload.checkboxAge,
      checkbox_marketing: payload.checkboxMarketing,
      scroll_gated: payload.scrollGated ?? true,
    });

    if (error) {
      console.error("Terms acceptance insert error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Terms acceptance error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Check if the current user has accepted the currently active terms version.
 * Uses the server-side function for consistency.
 */
export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    // Use the server-side function for authoritative check
    const { data, error } = await supabase.rpc("user_has_accepted_current_terms", {
      p_user_id: user.id,
    });

    if (error) {
      console.error("Terms acceptance check error:", error);
      throw new Error("No se pudo comprobar tu aceptación. Reintenta.");
    }

    return !!data;
  } catch (error) {
    throw error instanceof Error ? error : new Error("No se pudo comprobar tu aceptación. Reintenta.");
  }
}

/**
 * Get user's acceptance history (for Settings > Legal)
 * Returns ONLY summary data — no IP/user_agent (data minimization)
 */
export async function getUserAcceptanceHistory() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("terms_acceptance")
    .select("id, terms_version, privacy_policy_version, accepted_at, acceptance_method, checkbox_terms, checkbox_age, checkbox_marketing")
    .eq("user_id", user.id)
    .order("accepted_at", { ascending: false });

  return data || [];
}
