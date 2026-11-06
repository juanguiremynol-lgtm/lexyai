import { beforeEach, describe, expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({pubs:[] as any[]}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:(table:string)=>{
  const data=table==="work_item_publicaciones"?state.pubs:[];
  const builder:any={};
  for(const method of ["select","eq","is","gte","lte","order","in","limit"])builder[method]=()=>builder;
  builder.then=(resolve:any,reject:any)=>Promise.resolve({data,error:null}).then(resolve,reject);
  return builder;
}}}));
import { getTickerItems } from "./ticker-data-service";
import { getEstadosHoy } from "./estados-hoy-service";

beforeEach(()=>{state.pubs=[{id:"estado25",work_item_id:"wi",title:"ESTADO 25 DE 09 DE JUNIO DE 2025",
  annotation:"Estado 25",published_at:"2025-06-11T12:00:00Z",fecha_fijacion:"2025-06-09T13:00:00Z",
  fecha_desfijacion:null,source:"publicaciones",raw_data:{},created_at:"2026-11-06T12:00:00Z",
  work_items:{id:"wi",radicado:"05001333300320250013300",workflow_type:"CPACA",organization_id:"org"}}];});

describe("publication readers preserve the legal date",()=>{
  it("shows the fixation date instead of the portal upload date in both views",async()=>{
    const ticker=await getTickerItems("org");
    const hoy=await getEstadosHoy("org");
    expect(ticker[0].date).toBe("2025-06-09T13:00:00Z");
    expect(ticker[0].date_kind).toBe("fijacion");
    expect(hoy.items[0].date).toBe("2025-06-09T13:00:00Z");
    expect(hoy.items[0].inicia_termino).toBeNull();
    expect(hoy.items[0].is_in_ejecutoria_window).toBe(false);
  });
  it("does not substitute an upload date when fixation is missing",async()=>{
    state.pubs[0].fecha_fijacion=null;
    expect((await getTickerItems("org"))[0].date).toBeNull();
    const hoy=await getEstadosHoy("org");
    expect(hoy.items[0].date).toBeNull();
    expect(hoy.items[0].inicia_termino).toBeNull();
  });
});
