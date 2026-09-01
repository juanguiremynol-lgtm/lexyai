/**
 * JD1/JD2 — a reserva on the ACTUACIONES channel may never silence, gate or
 * degrade the ESTADOS channel, and the lawyer must be told so per matter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RESERVA_TITLE,
  estadosChannelName,
  reservaNotice,
  reservaNoticeShort,
} from "@/lib/reserva-notice";
import { exposureMessage } from "@/components/work-items/linea-procesal/ExposicionDetalleStatus";

const estadosCronRaw = readFileSync("supabase/functions/scheduled-daily-estados/index.ts", "utf8");
// Comments describe the doctrine; the assertions below are about executable code.
const estadosCron = estadosCronRaw
  .split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

const edgeMirror = readFileSync("supabase/functions/_shared/reservaNotice.ts", "utf8");

describe("JD1 — the estados cron selects on lifecycle only", () => {
  it("never reads any actuaciones-channel signal", () => {
    for (const forbidden of [
      "provider_detail_exposure",
      "PROCESO_PRIVADO",
      "sync-by-work-item",
      "external_sync_runs",
      "last_synced_at",
    ]) {
      expect(estadosCron).not.toContain(forbidden);
    }
  });

  it("filters only on the lawyer's own decision", () => {
    expect(estadosCron).toContain('.eq("lifecycle_state", "ACTIVE")');
    expect(estadosCron).toContain('.eq("monitoring_enabled", true)');
    expect(estadosCron).toContain('.is("deleted_at", null)');
  });
});

describe("JD2 — the per-matter explanation names the channel", () => {
  it("routes each workflow to its estados channel", () => {
    expect(estadosChannelName("CGP")).toBe("Publicaciones Procesales");
    expect(estadosChannelName("LABORAL")).toBe("Publicaciones Procesales");
    expect(estadosChannelName("CPACA")).toBe("SAMAI Estados");
    expect(estadosChannelName("PETICION")).toBeNull();
  });

  it("presents the reserva as a provider CLAIM, never as an established fact", () => {
    const cgp = reservaNotice("CGP");
    // JF1(a) — attribution to the provider, and an explicit denial of factuality.
    expect(cgp).toContain("proveedor");
    expect(cgp.toLowerCase()).toContain("no un hecho comprobado");
    expect(cgp).not.toContain("El juzgado marcó");
    expect(cgp).toContain("obligación legal");
    expect(cgp).toContain("Publicaciones Procesales");
    expect(reservaNotice("CPACA")).toContain("SAMAI Estados");
    expect(reservaNoticeShort("CGP")).toContain("Publicaciones Procesales");
    expect(reservaNoticeShort("CGP")).toContain("proveedor");
    expect(RESERVA_TITLE).toBe("El proveedor reporta el expediente como reservado");
    for (const word of ["falla", "degradad"]) {
      expect(cgp.toLowerCase()).not.toContain(word);
    }
  });

  it("the detail view renders a reserva as informative, not destructive", () => {
    const msg = exposureMessage(
      {
        provider_detail_exposure: "PROCESO_PRIVADO",
        provider_detail_reason: "PROCESO_PRIVADO",
        provider_detail_ultima_verificacion: new Date().toISOString(),
        provider_detail_ttl_days: 30,
      },
      "CGP",
    );
    expect(msg).not.toBeNull();
    expect(msg!.negative).toBe(false);
    expect(msg!.text).toContain("Publicaciones Procesales");
  });

  it("the edge mirror is kept in lockstep with the app copy", () => {
    expect(edgeMirror).toContain("no un hecho comprobado");
    expect(edgeMirror).toContain("obligación legal, y este se sigue leyendo por");
    expect(edgeMirror).toContain("SAMAI Estados");
  });
});
