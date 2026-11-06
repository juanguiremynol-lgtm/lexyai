import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/services/atenia-ai-engine', () => ({ suspendMonitoring: vi.fn(), reactivateMonitoring: vi.fn() }));
import { WorkItemMonitoringBadge } from './WorkItemMonitoringBadge';

describe('monitoring badge', () => {
  it('does not describe an unreachable provider as zero successful checks', () => {
    const html = renderToStaticMarkup(<WorkItemMonitoringBadge workItem={{
      id:'case', monitoring_enabled:true, provider_reachable:false, consecutive_404_count:0,
      last_error_code:'SAMAI_SOURCE_LAST_ATTEMPT_FAILED',
    }} />);
    expect(html).toContain('Respuesta del proveedor no confirmada');
    expect(html).not.toContain('0 consultas');
    expect(html).not.toContain('Monitoreado');
  });
  it('does not equate an empty provider response with absence of judicial events', () => {
    const html = renderToStaticMarkup(<WorkItemMonitoringBadge workItem={{
      id:'case', monitoring_enabled:true, last_error_code:'PROVIDER_EMPTY_RESULT',
    }} />);
    expect(html).toContain('no demuestra que el expediente carezca de movimientos');
    expect(html).not.toContain('el portal judicial no registra');
  });
  it('does not promise automatic checks while monitoring is suspended', () => {
    const html = renderToStaticMarkup(<WorkItemMonitoringBadge workItem={{
      id:'case', monitoring_enabled:false, demonitor_reason:'Suspendido manualmente',
    }} />);
    expect(html).toContain('Monitoreo suspendido');
    expect(html).toContain('consultas automáticas no están acreditadas');
    expect(html).not.toContain('sigue leyéndose todos los días');
  });
});
