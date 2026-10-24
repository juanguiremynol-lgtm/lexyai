import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getStageOrderForWorkflow, type CGPPhase, type WorkflowType } from "../../workflow-constants";
import { getOrderedCGPStages } from "../../cgp-stages";

// The server-side stage vocabulary (public._mcp_stage_vocab) must match the app's stored-stage constants.
const dir = join(__dirname, "../../../../drizzle/migrations");
const latest = readdirSync(dir).filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(join(dir, f), "utf8").includes("FUNCTION public._mcp_stage_vocab()")).sort().pop()!;
const sql = readFileSync(join(dir, latest), "utf8");
const rows = [...sql.matchAll(/\('([A-Z_0-9]+)','([A-Z_0-9]+)',(\d+|NULL),(?:'(FILING|PROCESS)'|NULL),(true|false)\)/g)]
  .map((m) => ({ wf: m[1], code: m[2], ord: m[3] === "NULL" ? null : Number(m[3]), phase: m[4] ?? null, movable: m[5] === "true" }));
const codes = (wf: string) => rows.filter((r) => r.wf === wf).map((r) => r.code);

describe("MCP stage vocabulary parity", () => {
  it("CGP Kanban stages are movable in order with their phase", () => {
    const kanban = getOrderedCGPStages().map((s) => s.key);
    const movable = rows.filter((r) => r.wf === "CGP" && r.movable).sort((a, b) => a.ord! - b.ord!);
    expect(movable.map((r) => r.code)).toEqual(kanban);
    expect(movable.find((r) => r.code === "ADMISION")?.phase).toBe("PROCESS");
    expect(movable.find((r) => r.code === "RADICADO")?.phase).toBe("FILING");
  });
  it("legacy CGP keys are known (valid current/creation stage) but not move targets", () => {
    for (const ph of ["FILING", "PROCESS"] as CGPPhase[])
      for (const k of getStageOrderForWorkflow("CGP" as WorkflowType, ph)) expect(codes("CGP")).toContain(k);
    expect(rows.find((r) => r.wf === "CGP" && r.code === "DRAFTED")?.movable).toBe(false);
  });
  it.each(["CPACA", "TUTELA", "EJECUTIVO", "LABORAL", "PENAL_906"])("%s matches application order", (wf) => {
    expect(codes(wf)).toEqual(getStageOrderForWorkflow(wf as WorkflowType));
  });
  it("catalog-governed workflows are not in the code vocabulary", () => {
    expect(codes("PETICION")).toEqual([]);
    expect(codes("GOV_PROCEDURE")).toEqual([]);
  });
});
