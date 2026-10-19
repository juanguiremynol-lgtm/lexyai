import type { PpEstado } from "@/hooks/use-pp-estados";

/** One display inventory: incorporated records or the external fallback. */
export function estadosDisplayInventory(candidates: PpEstado[]): PpEstado[] {
  const incorporated = candidates.filter(row => String(row.id).startsWith('local-'));
  return reconcileEstados(incorporated.length ? incorporated : candidates);
}

function normalizeTitleForDedupe(value: string | null | undefined): string {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function reconcileEstados(candidates: PpEstado[]): PpEstado[] {
    // Only corroborated API/local observations may share a display row.
    // Native publication identities and their document associations survive.
    const DAY_MS = 86_400_000;
    const WINDOW_DAYS = 2;
    const parseDay = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
    };
    // Document identity for the over-merge guard: prefer `hash_documento`
    // when the provider supplied it, otherwise fall back to the pathname of
    // whichever document URL is present. Returns null when no identity is
    // available — those rows keep the legacy name+window merge behavior.
    const docIdentity = (r: PpEstado): string | null => {
      const h = (r as any).hash_documento;
      if (typeof h === "string" && h.trim()) return `h:${h.trim()}`;
      const url = r.pdf_url || r.gcs_url_auto || r.gcs_url_tabla;
      if (typeof url === "string" && url.trim()) {
        try {
          const u = new URL(url);
          return `u:${u.pathname}`;
        } catch {
          return `u:${url}`;
        }
      }
      return null;
    };
    const groups = new Map<string, PpEstado[]>();
    for (const r of candidates) {
      const nt = normalizeTitleForDedupe(r.descripcion) || `__notitle__:${r.fuente}-${r.id}`;
      const arr = groups.get(nt) ?? [];
      arr.push(r);
      groups.set(nt, arr);
    }
    const mergeInto = (target: PpEstado, next: PpEstado): PpEstado => {
      // A local publication carries the permission-bound storage association.
      // Keep its identity and publication date when adding an API observation.
      const primary = String(next.id).startsWith('local-') ? next : target;
      const secondary = primary === target ? next : target;
      return {
        ...primary,
        gcs_url_auto: primary.gcs_url_auto || secondary.gcs_url_auto || null,
        gcs_url_tabla: primary.gcs_url_tabla || secondary.gcs_url_tabla || null,
        pdf_url: primary.pdf_url || secondary.pdf_url || null,
        titulo_original: primary.titulo_original || secondary.titulo_original || null,
        estado_numero: primary.estado_numero || secondary.estado_numero || null,
      };
    };
    const out: PpEstado[] = [];
    for (const [, rows] of groups) {
      // Sort by fecha asc (nulls last) for deterministic clustering that
      // picks the earliest as the anchor.
      const sorted = [...rows].sort((a, b) => {
        const da = parseDay(a.fecha);
        const db = parseDay(b.fecha);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
      const clusters: PpEstado[] = [];
      for (const r of sorted) {
        const rDay = parseDay(r.fecha);
        const rIdent = docIdentity(r);
        // Find an existing cluster whose anchor date is within window,
        // OR (if r has no fecha) any cluster with the same normalized
        // name — nameless-date rows always fold in when possible.
        // Over-merge guard: when BOTH candidates carry a document
        // identity and the identities differ, do NOT merge — these are
        // genuinely distinct estados that happen to share a title and
        // date (e.g. three "Auto admite llamamiento en garantía" on the
        // same day, each with a different attachment).
        let absorbed = false;
        for (let i = 0; i < clusters.length; i++) {
          const cDay = parseDay(clusters[i].fecha);
          const within =
            rDay === null ||
            cDay === null ||
            Math.abs(rDay - cDay) <= WINDOW_DAYS;
          if (!within) continue;
          const cIdent = docIdentity(clusters[i]);
          const current = clusters[i];
          const source = (v: string) => ['PP', 'PUBLICACIONES', 'PUBLICACIONES_PROCESALES'].includes(v.toUpperCase()) ? 'PP' : v.toUpperCase();
          if (source(current.fuente) !== source(r.fuente)) continue;
          const currentLocal = String(current.id).startsWith('local-');
          const incomingLocal = String(r.id).startsWith('local-');
          // Different native/publication identities survive even for identical
          // file bytes. Date/title proximity alone is never enough to merge.
          if (currentLocal === incomingLocal && current.id !== r.id) continue;
          if (currentLocal !== incomingLocal) {
            if (rDay === null || cDay !== rDay || !rIdent || rIdent !== cIdent) continue;
            const localMatches = candidates.filter(candidate => String(candidate.id).startsWith('local-')
              && source(candidate.fuente) === source(r.fuente)
              && normalizeTitleForDedupe(candidate.descripcion) === normalizeTitleForDedupe(r.descripcion)
              && parseDay(candidate.fecha) === rDay && docIdentity(candidate) === rIdent);
            if (localMatches.length !== 1) continue;
          }
          if (rIdent && cIdent && rIdent !== cIdent) continue;
          clusters[i] = mergeInto(clusters[i], r);
          absorbed = true;
          break;
        }
        if (!absorbed) clusters.push({ ...r });
      }
      for (const c of clusters) out.push(c);
    }
    // Sort final list by fecha desc (nulls last) for display.
    out.sort((a, b) => {
      const da = parseDay(a.fecha);
      const db = parseDay(b.fecha);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return db - da;
    });
    return out;
}
