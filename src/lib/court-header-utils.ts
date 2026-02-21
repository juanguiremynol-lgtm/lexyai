/**
 * Court header utilities for Poder Especial documents.
 * Builds formal court addressing headers per Colombian legal convention.
 */

import { supabase } from "@/integrations/supabase/client";

export type CourtAddressingMode = "specific" | "reparto" | "generic";

export interface CourtHeaderData {
  mode: CourtAddressingMode;
  judge_name?: string;
  court_name?: string;
  court_city?: string;
  court_email?: string;
  court_type_reparto?: string;
}

export function autoSelectCourtMode(workItem: {
  juzgado_nombre?: string | null;
  authority_name?: string | null;
  radicado?: string | null;
  ciudad?: string | null;
  authority_city?: string | null;
}): CourtAddressingMode {
  const courtName = workItem.juzgado_nombre || workItem.authority_name;
  if (courtName && workItem.radicado) return "specific";
  if (workItem.authority_city || workItem.ciudad) return "reparto";
  return "generic";
}

export function buildCourtHeaderHtml(data: CourtHeaderData): string {
  if (data.mode === "generic") {
    return `<p>Señor(a) Juez<br/>Rama Judicial del Poder Público</p>`;
  }

  if (data.mode === "reparto") {
    const courtType = data.court_type_reparto || "Civil del Circuito";
    const city = data.court_city || "";
    return [
      `<p>Señor(a)<br/>`,
      `<strong>Juez ${courtType} de ${city} (Reparto)</strong><br/>`,
      `Rama Judicial del Poder Público<br/>`,
      city ? `${city}</p>` : `</p>`,
    ].join("");
  }

  // 'specific' mode
  const lines: string[] = [];

  if (data.judge_name?.trim()) {
    lines.push(`Doctor(a)<br/><strong>${data.judge_name.toUpperCase()}</strong>`);
  } else if (data.court_name?.trim()) {
    lines.push(`Doctor(a)`);
  } else {
    lines.push(`Señor(a) Juez`);
  }

  if (data.court_name?.trim()) {
    lines.push(`<strong>${data.court_name}</strong>`);
  }

  lines.push(`Rama Judicial del Poder Público`);

  if (data.court_city?.trim()) {
    lines.push(data.court_city);
  }

  if (data.court_email?.trim()) {
    lines.push(`<em>${data.court_email}</em>`);
  }

  return `<p>${lines.join("<br/>")}</p>`;
}

export function extractCourtCode(radicado: string): string | null {
  if (!radicado || radicado.replace(/[^0-9]/g, "").length < 14) return null;
  const digits = radicado.replace(/[^0-9]/g, "");
  return digits.substring(0, 14);
}

export async function inferCourtEmail(workItem: {
  radicado?: string | null;
  authority_name?: string | null;
  juzgado_nombre?: string | null;
  courthouse_directory_id?: number | null;
}): Promise<{ email: string | null; courtName?: string; judgeName?: string }> {
  // Strategy 0: Direct lookup by courthouse_directory_id (most reliable)
  if (workItem.courthouse_directory_id) {
    const { data } = await supabase
      .from("courthouse_directory")
      .select("email, nombre_raw")
      .eq("id", workItem.courthouse_directory_id)
      .maybeSingle();
    const row = data as { email: string; nombre_raw: string } | null;
    if (row?.email) {
      console.log("[inferCourtEmail] Resolved via directory ID:", workItem.courthouse_directory_id);
      return { email: row.email, courtName: row.nombre_raw };
    }
  }

  // Strategy 1: Look up in courthouse_directory by normalized name match
  const courtName = workItem.juzgado_nombre || workItem.authority_name;
  if (courtName) {
    // Normalize: remove accents, collapse whitespace, strip punctuation for better ilike matching
    const normalized = courtName
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,'"""''()\-–—]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    console.log("[inferCourtEmail] Trying name match:", { original: courtName, normalized });

    const { data } = await supabase
      .from("courthouse_directory")
      .select("email, nombre_raw")
      .ilike("nombre_raw", `%${normalized}%`)
      .limit(1)
      .maybeSingle();
    const row = data as { email: string; nombre_raw: string } | null;
    if (row?.email) {
      console.log("[inferCourtEmail] Resolved via name ilike:", row.nombre_raw);
      return { email: row.email, courtName: row.nombre_raw };
    }
  }

  // Strategy 2: Look up in court_emails by code extracted from radicado
  if (workItem.radicado) {
    const code = extractCourtCode(workItem.radicado);
    if (code) {
      console.log("[inferCourtEmail] Trying radicado code:", code);
      const { data } = await (supabase as any)
        .from("court_emails")
        .select("court_email, court_name, judge_name")
        .eq("court_code", code)
        .maybeSingle();
      const row = data as { court_email: string; court_name: string; judge_name: string } | null;
      if (row?.court_email) {
        return { email: row.court_email, courtName: row.court_name, judgeName: row.judge_name };
      }
    }
  }

  // Strategy 3: Fuzzy match in court_emails by name
  if (courtName) {
    const { data } = await (supabase as any)
      .from("court_emails")
      .select("court_email, court_name, judge_name")
      .ilike("court_name", `%${courtName}%`)
      .limit(1)
      .maybeSingle();
    const row = data as { court_email: string; court_name: string; judge_name: string } | null;
    if (row?.court_email) {
      return { email: row.court_email, courtName: row.court_name, judgeName: row.judge_name };
    }
  }

  console.warn("[inferCourtEmail] No match found for:", { authority_name: courtName, radicado: workItem.radicado, directory_id: workItem.courthouse_directory_id });
  return { email: null };
}

export async function saveCourtEmailContribution(
  courtName: string,
  courtEmail: string,
  courtCity?: string,
  courtCode?: string | null,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await (supabase as any).from("court_emails").upsert(
    {
      court_code: courtCode || null,
      court_name: courtName,
      court_email: courtEmail,
      court_city: courtCity || null,
      source: "user_contribution",
      contributed_by: user.id,
      verified_at: new Date().toISOString(),
    },
    { onConflict: "court_code" },
  );
}

export const COURT_TYPE_OPTIONS = [
  "Civil del Circuito",
  "Civil Municipal",
  "Penal del Circuito",
  "Penal Municipal",
  "Laboral del Circuito",
  "Administrativo",
  "Familia",
  "Promiscuo Municipal",
  "Promiscuo del Circuito",
];
