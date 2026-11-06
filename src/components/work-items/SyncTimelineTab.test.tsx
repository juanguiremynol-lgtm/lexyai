import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@tanstack/react-query", () => ({useQuery: () => ({data:state.rows,isLoading:false,error:null})}));
vi.mock("@/integrations/supabase/client", () => ({supabase:{}}));
vi.mock("@/components/ui/card", async () => {
  const React = await import("react"); const View = ({children}:any) => React.createElement("div",null,children);
  return {Card:View,CardContent:View,CardHeader:View,CardTitle:View};
});
vi.mock("@/components/ui/badge", async () => {
  const React = await import("react"); return {Badge:({children}:any) => React.createElement("span",null,children)};
});
vi.mock("@/components/ui/skeleton", () => ({Skeleton:()=>null}));
vi.mock("@/components/ui/alert", async () => {
  const React=await import("react");const View=({children}:any)=>React.createElement("div",null,children);
  return {Alert:View,AlertDescription:View,AlertTitle:View};
});
vi.mock("lucide-react", () => ({AlertCircle:()=>null,CheckCircle2:()=>null,Clock:()=>null,GitCommit:()=>null,MinusCircle:()=>null,XCircle:()=>null}));
import { SyncTimelineTab } from "./SyncTimelineTab";

describe("work item timeline", () => {
  it("renders contradictory success and deferred partial reads without success or empty labels", () => {
    const common={provider:"publicaciones",providers:["publicaciones"],operation:"estados",finished_at:"2026-11-06T12:00:00Z",
      records_inserted:0,records_skipped:0,metadata:null};
    state.rows=[{...common,id:"1",status:"success",error_code:"PROVIDER_UNRESOLVED"},
      {...common,id:"2",status:"deduplicated",error_code:"PP_STORED_READ_INCOMPLETE",
        error_message:"La vigilancia diaria no está acreditada.",metadata:{stored_result_read:{reason:"PP_RUN_PARCIAL: ESTADO_SIN_DOCUMENTO"}}}];
    const html=renderToStaticMarkup(React.createElement(SyncTimelineTab,{workItemId:"synthetic"}));
    expect(html).toContain("Consulta no acreditada");
    expect(html).toContain("Sin consulta nueva");
    expect(html).toContain("No se recuperó el documento");
    expect(html).not.toContain("Consulta con resultados");
    expect(html).not.toContain("Sin resultados");
  });
});
