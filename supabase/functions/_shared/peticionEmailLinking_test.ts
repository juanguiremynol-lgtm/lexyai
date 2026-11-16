import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyAdministrativeEmail, decideAdministrativeLinks, extractProposedOfficialId,
  bogotaDate, eventCodeFor, type AdminLinkContext, type AdminWorkItem,
} from "./peticionEmailLinking.ts";
import { buildAdminLinkRow } from "./peticionEmailEvents.ts";
import type { GraphMessage } from "./emailMatcher.ts";

const SELF = "abogado@firma.test";
const wi = (id: string, o: Partial<AdminWorkItem> = {}): AdminWorkItem => ({
  id, organization_id: "org-a", workflow_type: "PETICION", authority_email: "pqrs@autoridad.gov.co",
  authority_radicado: null, email_linking_enabled: true, lifecycle_state: "ACTIVE", ...o,
});
const ctx = (items: AdminWorkItem[], conf: [string, string, string | null][] = []): AdminLinkContext => {
  const c: AdminLinkContext = { items, confirmedByInternetId: new Map(), confirmedByConversation: new Map(), selfAddress: SELF };
  for (const [w, imid, conv] of conf) {
    (c.confirmedByInternetId.get(imid) ?? c.confirmedByInternetId.set(imid, new Set()).get(imid)!).add(w);
    if (conv) (c.confirmedByConversation.get(conv) ?? c.confirmedByConversation.set(conv, new Set()).get(conv)!).add(w);
  }
  return c;
};
const msg = (o: Partial<GraphMessage>): GraphMessage => ({
  id: "g1", subject: "Derecho de petición", bodyPreview: "", from: { emailAddress: { address: SELF } },
  toRecipients: [{ emailAddress: { address: "pqrs@autoridad.gov.co" } }], conversationId: "c1",
  internetMessageId: "<m1@x>", sentDateTime: "2026-11-16T15:00:00Z", ...o,
});

Deno.test("sent before matter creation: authority mailbox only suggests, never confirms", () => {
  const d = decideAdministrativeLinks(msg({}), ctx([wi("A")]));
  assertEquals(d.map((x) => [x.work_item_id, x.link_status, x.matched_by]), [["A", "SUGGESTED", "DESPACHO"]]);
});

Deno.test("later acknowledgement inherits a confirmed conversation", () => {
  const ack = msg({ id: "g2", internetMessageId: "<m2@x>", from: { emailAddress: { address: "pqrs@autoridad.gov.co" } },
    toRecipients: [{ emailAddress: { address: SELF } }], subject: "Acuse de recibo" });
  const d = decideAdministrativeLinks(ack, ctx([wi("A"), wi("B")], [["A", "<m1@x>", "c1"]]));
  const a = d.find((x) => x.work_item_id === "A")!;
  assertEquals([a.link_status, a.matched_by], ["CONFIRMED", "CONVERSACION"]);
  assertEquals(d.find((x) => x.work_item_id === "B")?.link_status, "SUGGESTED");
  assertEquals(classifyAdministrativeEmail(ack, "received"), "ACUSE_RECIBO");
});

Deno.test("several requests to the same authority: none auto-confirmed", () => {
  const d = decideAdministrativeLinks(msg({ conversationId: "new" }), ctx([wi("A"), wi("B"), wi("C")]));
  assertEquals(d.every((x) => x.link_status === "SUGGESTED"), true);
  assertEquals(d.length, 3);
});

Deno.test("conversation shared by two confirmed matters is ambiguous", () => {
  const d = decideAdministrativeLinks(msg({ internetMessageId: "<z>" }),
    ctx([wi("A", { authority_email: null }), wi("B", { authority_email: null })], [["A", "<a>", "c1"], ["B", "<b>", "c1"]]));
  assertEquals(d.map((x) => x.link_status).sort(), ["SUGGESTED", "SUGGESTED"]);
});

Deno.test("unique official identifier confirms; duplicated one only suggests", () => {
  const m = msg({ subject: "Respuesta radicado CE-2026-1234", conversationId: "x", toRecipients: [] });
  const one = decideAdministrativeLinks(m, ctx([wi("A", { authority_radicado: "CE 2026 1234" }), wi("B")]));
  assertEquals(one.map((x) => [x.work_item_id, x.link_status, x.matched_by]), [["A", "CONFIRMED", "IDENTIFICADOR_OFICIAL"]]);
  const two = decideAdministrativeLinks(m, ctx([wi("A", { authority_radicado: "CE-2026-1234" }), wi("B", { authority_radicado: "CE20261234" })]));
  assertEquals(two.every((x) => x.link_status === "SUGGESTED"), true);
  // Identifier embedded in a longer token is not identity.
  assertEquals(decideAdministrativeLinks(msg({ subject: "CE-2026-12345", toRecipients: [], conversationId: "y" }),
    ctx([wi("A", { authority_radicado: "CE-2026-1234" })])).length, 0);
});

Deno.test("domain, authority name, generic subject never link", () => {
  const m = msg({ toRecipients: [{ emailAddress: { address: "otro@autoridad.gov.co" } }], subject: "Autoridad Regional petición", conversationId: "q" });
  assertEquals(decideAdministrativeLinks(m, ctx([wi("A")])).length, 0);
});

Deno.test("disabled, archived and judicial matters are ignored; tenants only see their context", () => {
  const items = [wi("A", { email_linking_enabled: false }), wi("B", { lifecycle_state: "ARCHIVED" }), wi("C", { workflow_type: "CGP" })];
  assertEquals(decideAdministrativeLinks(msg({}), ctx(items, [["A", "<m1@x>", "c1"]])).length, 0);
  // Another tenant's confirmed conversation does not exist in this context.
  assertEquals(decideAdministrativeLinks(msg({ toRecipients: [] }), ctx([wi("D", { authority_email: null })])).length, 0);
});

Deno.test("partial vs substantive answers stay review hints", () => {
  const r = (s: string) => classifyAdministrativeEmail(msg({ subject: s, from: { emailAddress: { address: "a@b.gov.co" } } }), "received");
  assertEquals(r("Respuesta de fondo a su petición"), "POSIBLE_RESPUESTA");
  assertEquals(r("Respuesta parcial y prórroga del término"), "PRORROGA");
  assertEquals(r("Requerimiento para completar la petición"), "REQUERIMIENTO");
  assertEquals(r("Traslado por competencia"), "TRASLADO_COMPETENCIA");
  assertEquals(r("Su solicitud quedó radicada con el número 2026-ER-555"), "RADICADO_ASIGNADO");
  assertEquals(extractProposedOfficialId(msg({ subject: "Radicado No. 2026-ER-555" })), "2026-ER-555");
  assertEquals(classifyAdministrativeEmail(msg({ subject: "Respuesta" }), "sent"), "ENVIO");
});

Deno.test("idempotency keys and no judicial effects on stored rows", () => {
  const decision = decideAdministrativeLinks(msg({}), ctx([wi("A")]))[0];
  const row = buildAdminLinkRow({ userId: "u", connectionId: null, msg: msg({}), direction: "sent", decision, provenance: {} });
  assertEquals([row.message_id, row.work_item_id, row.evidence_type, row.evidence_subtype], ["g1", "A", "OTRO", null]);
  assertEquals(row.evidence_meta.legal_anchor, false);
  assertEquals("body" in row, false);
  assertEquals(eventCodeFor("ENVIO"), "EMAIL_ENVIO_OBSERVADO");
  assertEquals(bogotaDate("2026-11-17T03:00:00Z"), "2026-11-16");
  // Re-running the decision yields the same single row key.
  assertEquals(decideAdministrativeLinks(msg({}), ctx([wi("A")])).length, 1);
});
