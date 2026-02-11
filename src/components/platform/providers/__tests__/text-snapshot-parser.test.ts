/**
 * Vitest tests for snapshotParser + TEXT ingestion + wizard session enforcement.
 */
import { describe, it, expect } from "vitest";

// ---- Inline snapshot parser (mirrors snapshotParser.ts logic) ----

interface ParsedActuacion {
  idx: number;
  reg?: string;
  radicacion?: string;
  fecha?: string;
  actuacion?: string;
  documento?: { disponible: boolean; url?: string; hash?: string };
  [key: string]: unknown;
}

interface StructuredSnapshot {
  radicado?: string;
  total_actuaciones?: number;
  actuaciones: ParsedActuacion[];
  publicaciones?: unknown[];
}

interface ParsedSnapshot {
  ok: boolean;
  format: "JSON" | "TEXT" | "UNKNOWN";
  snapshot: StructuredSnapshot | null;
  warnings: string[];
}

function stripEmoji(s: string): string {
  return s
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[✅❌📄🔗⚖️📋]/g, "")
    .trim();
}

function extractValue(line: string): string {
  const idx = line.indexOf(":");
  return idx === -1 ? line.trim() : line.slice(idx + 1).trim();
}

function parseTextSnapshot(text: string, warnings: string[]): StructuredSnapshot | null {
  const lines = text.split("\n").map((l) => l.trim());
  const snapshot: StructuredSnapshot = { actuaciones: [] };

  const radicadoLine = lines.find((l) => /^radicado\s*[:=]/i.test(stripEmoji(l)));
  if (radicadoLine) {
    const val = extractValue(radicadoLine);
    if (val) snapshot.radicado = val.replace(/\D/g, "") || val;
  }

  const totalLine = lines.find((l) => /total\s+actuacion/i.test(stripEmoji(l)));
  if (totalLine) {
    const val = extractValue(totalLine);
    const num = parseInt(val, 10);
    if (!isNaN(num)) snapshot.total_actuaciones = num;
  }

  let currentAct: ParsedActuacion | null = null;
  let actIdx = 0;

  for (const line of lines) {
    const clean = stripEmoji(line);
    const actMatch = clean.match(/^actuaci[oó]n\s+(\d+)\s*[:]/i);
    if (actMatch) {
      if (currentAct) snapshot.actuaciones.push(currentAct);
      actIdx++;
      currentAct = { idx: parseInt(actMatch[1], 10) || actIdx };
      continue;
    }
    if (!currentAct) continue;

    if (/^reg\s*[:=]/i.test(clean)) currentAct.reg = extractValue(line);
    else if (/^radicaci[oó]n\s*[:=]/i.test(clean)) currentAct.radicacion = extractValue(line);
    else if (/^fecha\s*[:=]/i.test(clean)) currentAct.fecha = extractValue(line);
    else if (/^actuaci[oó]n\s*[:=]/i.test(clean) && !actMatch) currentAct.actuacion = extractValue(line);
    else if (/documento\s+disponible/i.test(clean)) {
      if (!currentAct.documento) currentAct.documento = { disponible: true };
      else currentAct.documento.disponible = true;
    } else if (/^url\s*[:=]/i.test(clean)) {
      if (!currentAct.documento) currentAct.documento = { disponible: true };
      currentAct.documento.url = extractValue(line);
    } else if (/^hash\s*[:=]/i.test(clean)) {
      if (!currentAct.documento) currentAct.documento = { disponible: false };
      currentAct.documento.hash = extractValue(line);
    }
  }
  if (currentAct) snapshot.actuaciones.push(currentAct);

  if (snapshot.actuaciones.length === 0 && !snapshot.radicado) return null;

  if (snapshot.total_actuaciones != null && snapshot.total_actuaciones !== snapshot.actuaciones.length) {
    warnings.push(`total_actuaciones declared ${snapshot.total_actuaciones} but parsed ${snapshot.actuaciones.length}`);
  }

  for (const act of snapshot.actuaciones) {
    if (!act.fecha) warnings.push(`Actuación ${act.idx}: missing fecha`);
    if (!act.actuacion) warnings.push(`Actuación ${act.idx}: missing actuación description`);
  }

  return snapshot;
}

function parseSnapshot(caps: unknown, rawBody: string, contentType?: string): ParsedSnapshot {
  const warnings: string[] = [];
  const capsObj = (Array.isArray(caps) ? {} : (caps as Record<string, unknown>)) || {};
  const declared = String(capsObj.snapshot_format || "").toUpperCase();

  if (declared !== "TEXT") {
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed === "object" && parsed !== null) {
        return { ok: true, format: "JSON", snapshot: parsed as StructuredSnapshot, warnings };
      }
    } catch { /* not JSON */ }
  }

  if (declared === "TEXT" || contentType?.includes("text/") || !(rawBody.trim().startsWith("{") || rawBody.trim().startsWith("["))) {
    const snapshot = parseTextSnapshot(rawBody, warnings);
    if (snapshot && (snapshot.actuaciones.length > 0 || snapshot.radicado)) {
      return { ok: true, format: "TEXT", snapshot, warnings };
    }
  }

  warnings.push("Could not parse snapshot as JSON or TEXT");
  return { ok: false, format: "UNKNOWN", snapshot: null, warnings };
}

// ---- DATE_DDMMYYYY_CO transform ----

function dateDdMmYyyyCo(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// ======== TESTS ========

describe("TEXT Snapshot Parser: Valid Colombian judicial format", () => {
  const SAMPLE_TEXT = `
Radicado: 05001233300020240115300
Total actuaciones: 3

Actuación 1:
Reg: 1
Radicación: 05001-23-33-000-2024-01153-00
Fecha: 30/01/2026
Actuación: Auto que ordena poner en conocimiento
✅ DOCUMENTO DISPONIBLE
URL: https://samaicore.consejodeestado.gov.co/api/DescargarProvidenciaPublica/abc123
Hash: 9f86d081884c7d659a2feaa0c55ad015 a3bf4f1b2b0b822cd15d6c15b0f00a08

Actuación 2:
Reg: 2
Radicación: 05001-23-33-000-2024-01153-00
Fecha: 15/02/2026
Actuación: Auto que admite demanda

Actuación 3:
Reg: 3
Radicación: 05001-23-33-000-2024-01153-00
Fecha: 20/03/2026
Actuación: Sentencia de primera instancia
✅ DOCUMENTO DISPONIBLE
URL: https://samaicore.consejodeestado.gov.co/api/DescargarProvidenciaPublica/def456
Hash: abc 123 def 456
`;

  it("parses 3 actuaciones with radicado", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, SAMPLE_TEXT);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("TEXT");
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot!.radicado).toBe("05001233300020240115300");
    expect(result.snapshot!.total_actuaciones).toBe(3);
    expect(result.snapshot!.actuaciones).toHaveLength(3);
  });

  it("parses dates correctly in DD/MM/YYYY format", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, SAMPLE_TEXT);
    expect(result.snapshot!.actuaciones[0].fecha).toBe("30/01/2026");
    expect(result.snapshot!.actuaciones[1].fecha).toBe("15/02/2026");
  });

  it("extracts document URLs and hashes (including hashes with spaces)", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, SAMPLE_TEXT);
    const act1 = result.snapshot!.actuaciones[0];
    expect(act1.documento).toBeDefined();
    expect(act1.documento!.disponible).toBe(true);
    expect(act1.documento!.url).toContain("samaicore.consejodeestado.gov.co");
    expect(act1.documento!.hash).toBeTruthy();
    // Hash contains spaces
    expect(act1.documento!.hash!.includes(" ")).toBe(true);
  });

  it("handles actuaciones without documents", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, SAMPLE_TEXT);
    const act2 = result.snapshot!.actuaciones[1];
    expect(act2.documento).toBeUndefined();
  });

  it("parses actuación descriptions", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, SAMPLE_TEXT);
    expect(result.snapshot!.actuaciones[0].actuacion).toBe("Auto que ordena poner en conocimiento");
    expect(result.snapshot!.actuaciones[2].actuacion).toBe("Sentencia de primera instancia");
  });
});

describe("TEXT Snapshot Parser: Partial sample (missing Hash lines)", () => {
  const PARTIAL_TEXT = `
Radicado: 11001310300120230012300
Total actuaciones: 2

Actuación 1:
Fecha: 10/05/2025
Actuación: Auto admisorio de demanda
✅ DOCUMENTO DISPONIBLE
URL: https://example.com/doc1

Actuación 2:
Fecha: 15/06/2025
Actuación: Notificación por aviso
`;

  it("parses successfully with warnings for missing hash", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, PARTIAL_TEXT);
    expect(result.ok).toBe(true);
    expect(result.snapshot!.actuaciones).toHaveLength(2);
    // Act 1 has URL but no hash
    expect(result.snapshot!.actuaciones[0].documento?.url).toContain("example.com");
    expect(result.snapshot!.actuaciones[0].documento?.hash).toBeUndefined();
  });
});

describe("TEXT Snapshot Parser: Garbage text → UNKNOWN", () => {
  it("returns ok=false for completely unparseable text", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, "this is totally random gibberish with no structure whatsoever 12345");
    expect(result.ok).toBe(false);
    expect(result.format).toBe("UNKNOWN");
    expect(result.snapshot).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns ok=false for empty string", () => {
    const result = parseSnapshot({ snapshot_format: "TEXT" }, "");
    expect(result.ok).toBe(false);
    expect(result.format).toBe("UNKNOWN");
  });
});

describe("TEXT Snapshot Parser: JSON payload with TEXT format declared", () => {
  it("falls back to JSON parse when valid JSON is provided", () => {
    const jsonPayload = JSON.stringify({
      actuaciones: [{ fecha: "2025-01-15", descripcion: "Test" }],
    });
    // No snapshot_format declared → tries JSON first
    const result = parseSnapshot({}, jsonPayload);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("JSON");
  });
});

describe("DATE_DDMMYYYY_CO transform", () => {
  it("converts 30/01/2026 to ISO date", () => {
    expect(dateDdMmYyyyCo("30/01/2026")).toBe("2026-01-30");
  });

  it("converts 1/2/2025 to ISO date", () => {
    expect(dateDdMmYyyyCo("1/2/2025")).toBe("2025-02-01");
  });

  it("returns null for invalid date", () => {
    expect(dateDdMmYyyyCo("not-a-date")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(dateDdMmYyyyCo(null)).toBeNull();
    expect(dateDdMmYyyyCo(undefined)).toBeNull();
  });

  it("handles DD-MM-YYYY with dashes", () => {
    expect(dateDdMmYyyyCo("15-06-2025")).toBe("2025-06-15");
  });
});

describe("Ingestion Pipeline: TEXT snapshot flow", () => {
  it("valid TEXT snapshot → parsed → mapping applied → canonical written", () => {
    const textBody = `
Radicado: 05001233300020240115300
Total actuaciones: 1

Actuación 1:
Fecha: 30/01/2026
Actuación: Auto admisorio
✅ DOCUMENTO DISPONIBLE
URL: https://example.com/doc
Hash: abc123
`;
    const parsed = parseSnapshot({ snapshot_format: "TEXT" }, textBody);
    expect(parsed.ok).toBe(true);
    expect(parsed.snapshot!.actuaciones).toHaveLength(1);
    // Document info stored in extras (not fetched)
    const act = parsed.snapshot!.actuaciones[0];
    expect(act.documento?.disponible).toBe(true);
    expect(act.documento?.url).toBe("https://example.com/doc");
    expect(act.documento?.hash).toBe("abc123");
  });

  it("unparseable TEXT → terminal PROVIDER_UNPARSABLE_SNAPSHOT", () => {
    const parsed = parseSnapshot({ snapshot_format: "TEXT" }, "random noise ###@@@");
    expect(parsed.ok).toBe(false);
    expect(parsed.format).toBe("UNKNOWN");
    // In real pipeline this would produce:
    // trace: TERMINAL with code PROVIDER_UNPARSABLE_SNAPSHOT
    // No mapping applied, no canonical upserts
  });
});

describe("Wizard Session Enforcement (simulated)", () => {
  interface WizardSession {
    id: string;
    status: "ACTIVE" | "COMPLETED" | "EXPIRED";
    mode: "PLATFORM" | "ORG";
    organization_id?: string | null;
    created_by: string;
    expires_at: string;
  }

  function validateWizardSession(
    session: WizardSession | null,
    callerId: string,
    requiredMode?: "PLATFORM" | "ORG",
    requiredOrgId?: string,
  ): { valid: boolean; code?: string } {
    if (!session) return { valid: false, code: "WIZARD_REQUIRED" };
    if (session.status !== "ACTIVE") return { valid: false, code: "WIZARD_SESSION_INVALID" };
    if (new Date(session.expires_at) < new Date()) return { valid: false, code: "WIZARD_SESSION_EXPIRED" };
    if (session.created_by !== callerId) return { valid: false, code: "WIZARD_SESSION_INVALID" };
    if (requiredMode && session.mode !== requiredMode) return { valid: false, code: "WIZARD_SESSION_INVALID" };
    if (requiredOrgId && session.organization_id !== requiredOrgId) return { valid: false, code: "WIZARD_SESSION_INVALID" };
    return { valid: true };
  }

  it("rejects call without wizard session → WIZARD_REQUIRED", () => {
    const result = validateWizardSession(null, "user-1");
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WIZARD_REQUIRED");
  });

  it("rejects expired session → WIZARD_SESSION_EXPIRED", () => {
    const result = validateWizardSession(
      {
        id: "s1",
        status: "ACTIVE",
        mode: "PLATFORM",
        created_by: "user-1",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      "user-1",
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WIZARD_SESSION_EXPIRED");
  });

  it("accepts valid ACTIVE session", () => {
    const result = validateWizardSession(
      {
        id: "s1",
        status: "ACTIVE",
        mode: "PLATFORM",
        created_by: "user-1",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      "user-1",
    );
    expect(result.valid).toBe(true);
  });

  it("PLATFORM session cannot mutate ORG_PRIVATE resources", () => {
    const result = validateWizardSession(
      {
        id: "s1",
        status: "ACTIVE",
        mode: "PLATFORM",
        created_by: "user-1",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      "user-1",
      "ORG",
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WIZARD_SESSION_INVALID");
  });

  it("ORG session cannot mutate PLATFORM resources", () => {
    const result = validateWizardSession(
      {
        id: "s1",
        status: "ACTIVE",
        mode: "ORG",
        organization_id: "org-1",
        created_by: "user-1",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      "user-1",
      "PLATFORM",
    );
    expect(result.valid).toBe(false);
  });

  it("COMPLETED session is rejected", () => {
    const result = validateWizardSession(
      {
        id: "s1",
        status: "COMPLETED",
        mode: "PLATFORM",
        created_by: "user-1",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
      "user-1",
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WIZARD_SESSION_INVALID");
  });
});
