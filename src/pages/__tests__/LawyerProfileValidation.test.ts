/**
 * Unit tests for contract-eligibility lawyer profile validation logic.
 * Validates correct column mapping: firma_abogado_cc, firma_abogado_tp, litigation_email.
 */
import { describe, it, expect } from "vitest";

interface LawyerProfile {
  full_name: string | null;
  firma_abogado_cc: string | null;
  firma_abogado_tp: string | null;
  litigation_email: string | null;
  firma_abogado_correo: string | null;
}

/**
 * Mirrors the validateLawyerProfile logic from contract-eligibility.ts
 */
function validateLawyerProfile(profile: LawyerProfile | null): {
  allowed: boolean;
  error?: string;
  error_code?: string;
} {
  if (!profile) {
    return { allowed: false, error: "Perfil de abogado no encontrado.", error_code: "PROFILE_NOT_FOUND" };
  }

  const missing: string[] = [];
  if (!profile.full_name) missing.push("nombre completo");
  if (!profile.firma_abogado_cc) missing.push("cédula");
  if (!profile.firma_abogado_tp) missing.push("tarjeta profesional");
  if (!profile.litigation_email && !profile.firma_abogado_correo) missing.push("email de litigación");

  if (missing.length > 0) {
    return {
      allowed: false,
      error: `Complete su perfil de abogado: faltan ${missing.join(", ")}.`,
      error_code: "LAWYER_PROFILE_INCOMPLETE",
    };
  }

  return { allowed: true };
}

describe("validateLawyerProfile", () => {
  it("allows complete profile", () => {
    expect(validateLawyerProfile({
      full_name: "Juan Restrepo",
      firma_abogado_cc: "1017133290",
      firma_abogado_tp: "226.135",
      litigation_email: "gr@lexetlit.com",
      firma_abogado_correo: null,
    })).toEqual({ allowed: true });
  });

  it("allows profile with firma_abogado_correo instead of litigation_email", () => {
    expect(validateLawyerProfile({
      full_name: "Juan Restrepo",
      firma_abogado_cc: "1017133290",
      firma_abogado_tp: "226.135",
      litigation_email: null,
      firma_abogado_correo: "gr@lexetlit.com",
    })).toEqual({ allowed: true });
  });

  it("rejects null profile", () => {
    const result = validateLawyerProfile(null);
    expect(result.allowed).toBe(false);
    expect(result.error_code).toBe("PROFILE_NOT_FOUND");
  });

  it("rejects profile missing cédula", () => {
    const result = validateLawyerProfile({
      full_name: "Juan",
      firma_abogado_cc: null,
      firma_abogado_tp: "226.135",
      litigation_email: "x@y.com",
      firma_abogado_correo: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("cédula");
  });

  it("rejects profile missing both email fields", () => {
    const result = validateLawyerProfile({
      full_name: "Juan",
      firma_abogado_cc: "123",
      firma_abogado_tp: "456",
      litigation_email: null,
      firma_abogado_correo: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("email de litigación");
  });

  it("lists all missing fields", () => {
    const result = validateLawyerProfile({
      full_name: null,
      firma_abogado_cc: null,
      firma_abogado_tp: null,
      litigation_email: null,
      firma_abogado_correo: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("nombre completo");
    expect(result.error).toContain("cédula");
    expect(result.error).toContain("tarjeta profesional");
    expect(result.error).toContain("email de litigación");
  });
});
