import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ organization: {id:'org'} as {id:string}|null,
  query: {data:[] as any[],isLoading:false,error:null as Error|null} }));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>state.query}));
vi.mock('@/contexts/OrganizationContext',()=>({useOrganization:()=>({organization:state.organization})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/lib/supabase-query-guard',()=>({ensureValidSession:async()=>{}}));
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}));
vi.mock('@/components/ui/card',async()=>{
  const React=await import('react'); const View=({children}:any)=>React.createElement('div',null,children);
  return {Card:View,CardContent:View,CardDescription:View,CardHeader:View,CardTitle:View};
});
vi.mock('@/components/ui/badge',async()=>{const React=await import('react');return {Badge:({children}:any)=>React.createElement('span',null,children)};});
vi.mock('@/components/ui/skeleton',()=>({Skeleton:()=>null}));
vi.mock('lucide-react',()=>({ShieldAlert:()=>null,ExternalLink:()=>null}));
import { AdminCoverageGapsTab } from './AdminCoverageGapsTab';

beforeEach(()=>{state.organization={id:'org'};state.query={data:[],isLoading:false,error:null};});
describe('coverage panel evidence and failures',()=>{
  it('does not interpret zero recorded gaps as healthy providers',()=>{
    const html=renderToStaticMarkup(React.createElement(AdminCoverageGapsTab));
    expect(html).toContain('No hay brechas de cobertura abiertas registradas');
    expect(html).toContain('no acredita que todas las fuentes');
    expect(html).not.toContain('Todos los proveedores están retornando datos correctamente');
  });
  it('shows unknown when the query fails or no organization is selected',()=>{
    state.query.error=new Error('offline');
    expect(renderToStaticMarkup(React.createElement(AdminCoverageGapsTab))).toContain('estado de las fuentes es desconocido');
    state.query.error=null;state.organization=null;
    expect(renderToStaticMarkup(React.createElement(AdminCoverageGapsTab))).toContain('estado de las fuentes es desconocido');
  });
  it('does not claim an exact count when the 100 row page is full',()=>{
    state.query.data=Array.from({length:100},(_,i)=>({id:String(i),provider_key:'pp',workflow:'CGP',radicado:'synthetic',last_seen_at:'2026-11-06T00:00:00Z',occurrences:1}));
    expect(renderToStaticMarkup(React.createElement(AdminCoverageGapsTab))).toContain('100 o más abiertas');
  });
});
