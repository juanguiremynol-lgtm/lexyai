import { selectEligibleWorkItems } from "./sync-eligibility.ts";
function assert(v: unknown) { if (!v) throw new Error("assertion failed"); }
Deno.test("an invalid-only candidate page is not the end of daily coverage", async () => {
  let cursor: string | undefined; const calls: unknown[][]=[];
  const query = {
    select: (...x: unknown[]) => {calls.push(["select",...x]);return query;},
    eq: (...x: unknown[]) => {calls.push(["eq",...x]);return query;},
    is: (...x: unknown[]) => {calls.push(["is",...x]);return query;},
    in: () => query, not: () => query, order: () => query, limit: () => query,
    or: (...x: unknown[]) => {calls.push(["or",...x]);return query;},
    gt: (_: string,x: string) => {cursor=x;return query;},
    then: (resolve: (v: unknown) => void) => resolve({error:null,data:cursor ? [{id:"b",radicado:"05001400302320250063800"}] : [{id:"a",radicado:"invalid"}]}),
  };
  const result=await selectEligibleWorkItems({from:()=>query},"org",{limit:1});
  assert(result.length===1 && result[0].id==="b");
  assert(calls.some(c=>c[0]==="eq" && c[1]==="monitoring_enabled" && c[2]===true));
  assert(calls.some(c=>c[0]==="is" && c[1]==="deleted_at"));
  assert(calls.some(c=>c[0]==="or" && String(c[1]).includes("stage.is.null")));
});
