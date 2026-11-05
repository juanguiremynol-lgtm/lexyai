import { describe, expect, it } from "vitest";
import { hasUnaccreditedAssociation, proceduralPublicationEvents } from "@/lib/publication-quality";
import { inferPhaseFromText } from "@/lib/workflow-phases";

describe("publication procedural attribution", () => {
  it.each([
    [false, false], [0, false], ["", false], [null, false], [undefined, false],
    [{}, true], [[], true], ["flag", true], [true, true],
  ])("matches UI truthiness for %j", (flag, expected) => {
    expect(hasUnaccreditedAssociation(flag)).toBe(expected);
  });
  const base = { fecha_fijacion: "2026-10-15", fecha_providencia: "2026-10-14", title: "Auto libra mandamiento de pago" };
  it("flagged publication cannot derive a phase or term event", () => {
    const rows = [{ ...base, association_flag: { causa: "unrelated official document" } }];
    expect(inferPhaseFromText("EJECUTIVO", base.title)).not.toBeNull();
    expect(proceduralPublicationEvents(rows)).toEqual([]);
    expect(rows).toHaveLength(1); // no deletion of the history inventory
  });
  it("preserves distinct legitimate stream events and their two original dates without claiming confirmation", () => {
    const events = proceduralPublicationEvents([{ ...base, association_flag: null },
      { ...base, fecha_fijacion: "2026-10-16", association_flag: false }]);
    expect(events).toEqual([
      { at: "2026-10-15", docDate: "2026-10-14", text: `${base.title} `, source: "ESTADO" },
      { at: "2026-10-16", docDate: "2026-10-14", text: `${base.title} `, source: "ESTADO" },
    ]);
    expect(events.every((e) => !("confirmed" in e))).toBe(true);
  });
  it("archives and undated rows remain ineligible; any truthy flag follows UI", () => {
    expect(proceduralPublicationEvents([{ ...base, is_archived: true },
      { title: "undated" }, { ...base, association_flag: "legacy flag" }])).toEqual([]);
  });
});