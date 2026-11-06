import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state=vi.hoisted(()=>({rows:[] as any[],error:null as Error|null}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:state.rows,isLoading:false,error:state.error})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{}}));
import { MonitoringEvidenceBanner, sourceSummaryLabel, unverifiedSources } from "./MonitoringEvidenceBanner";

const now=new Date("2026-11-06T16:00:00Z");
const success=(provider:string,operation:string,observed="2026-11-06T13:00:00Z") => ({provider,operation,status:"success",error_code:null,
  metadata:{source_complete:true,source_observed_at:observed}});
describe("visible source warning",()=>{
  it("requires today's complete source evidence and does not treat partial or missing records as success",()=>{
    const cpnu={...success("cpnu","acts"),status:"error",error_code:"CPNU_SYNC_FAILED"};
    const pp={...success("publicaciones","publicaciones"),status:"empty",metadata:{source_complete:false,source_observed_at:"2026-11-06T13:00:00Z"}};
    expect(unverifiedSources("CGP",[cpnu,pp],now)).toEqual(["CPNU (actuaciones)","Publicaciones Procesales (estados)"]);
    expect(unverifiedSources("CGP",[success("cpnu","acts"),success("publicaciones","publicaciones")],now)).toEqual([]);
    expect(unverifiedSources("CGP",[success("cpnu","acts","2026-11-05T13:00:00Z")],now)).toHaveLength(2);
    expect(unverifiedSources("CGP",[success("cpnu","acts"),{...success("publicaciones","publicaciones"),error_code:"PROVIDER_UNRESOLVED"}],now))
      .toEqual(["Publicaciones Procesales (estados)"]);
  });
  it("preserves valid evidence across a duplicate, but flags a later incomplete stored read",()=>{
    const cpnu=success("cpnu","acts"),pp=success("publicaciones","publicaciones");
    const dup={...pp,status:"deduplicated",error_code:"DAILY_UPDATE_ALREADY_STARTED"};
    expect(unverifiedSources("CGP",[dup,cpnu,pp],now)).toEqual([]);
    expect(unverifiedSources("CGP",[{...dup,error_code:"PP_STORED_READ_INCOMPLETE"},cpnu,pp],now))
      .toEqual(["Publicaciones Procesales (estados)"]);
  });
  it("uses only providers required by the workflow and handles a failed evidence read",()=>{
    const good=[success("samai","acts"),success("samai_estados","publicaciones"),{...success("cpnu","acts"),status:"error"}];
    expect(unverifiedSources("CPACA",good,now)).toEqual([]);
    state.error=new Error("offline");
    const html=renderToStaticMarkup(React.createElement(MonitoringEvidenceBanner,
      {workItemId:"synthetic",workflow:"CGP",enabled:true,radicado:"05001400300120250000100"}));
    expect(html).toContain("No se pudo consultar el historial de vigilancia");state.error=null;
    expect(sourceSummaryLabel("SUCCESS")).toBe("Resultado informado");
  });
});
