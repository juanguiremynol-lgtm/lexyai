import { describe, it, expect } from 'vitest';
import {
  sanitizeDigest,
  isWindowEmpty,
  buildGroundingBlock,
  EMPTY_WINDOW_STATEMENT,
  type GroundedFacts,
} from '../../supabase/functions/_shared/lexyGrounding.ts';

const EMPTY: GroundedFacts = { window: [], forward: [] };

const EMPTY_WITH_FORWARD: GroundedFacts = {
  window: [],
  forward: [
    {
      source_id: 'dl-1',
      source_table: 'work_item_deadlines',
      radicado: '05001333301020230019900',
      work_item_title: 'Caso A',
      text: 'Término abierto (traslado) vence el 2026-08-10',
      date: '2026-08-10',
    },
  ],
};

describe('Lexy grounding contract', () => {
  it('detects an empty 24h window', () => {
    expect(isWindowEmpty(EMPTY)).toBe(true);
    expect(isWindowEmpty(EMPTY_WITH_FORWARD)).toBe(true);
  });

  it('renders NINGUNO for an empty window', () => {
    expect(buildGroundingBlock(EMPTY)).toContain('NINGUNO');
  });

  it('drops fabricated items when the window is empty and nothing is forward-looking', () => {
    const out = sanitizeDigest(
      {
        greeting: 'Buenos días',
        summary_body: 'Hoy se decretó embargo en su proceso.',
        highlights: [
          { icon: '⚖️', text: 'Auto decreta embargo (29 de septiembre)' },
          { icon: '📄', text: 'Londoño: auto niega recurso por improcedencia' },
        ],
        closing: 'Saludos',
      },
      EMPTY,
    );
    expect(out.highlights).toHaveLength(0);
    expect(out.summary_body).toBe(EMPTY_WINDOW_STATEMENT);
  });

  it('keeps only forward-looking items when the window is empty', () => {
    const out = sanitizeDigest(
      {
        greeting: 'Buenos días',
        summary_body: 'Novedades de hoy',
        highlights: [
          { icon: '⚖️', text: 'Auto decreta embargo (29 de septiembre)' },
          { icon: '⏰', text: 'Término de traslado vence el 10 de agosto' },
        ],
        closing: 'Saludos',
      },
      EMPTY_WITH_FORWARD,
    );
    expect(out.summary_body).toContain(EMPTY_WINDOW_STATEMENT);
    expect(out.highlights.map((h) => h.text)).toEqual(['Término de traslado vence el 10 de agosto']);
  });

  it('removes claims about radicados with no live source row', () => {
    const facts: GroundedFacts = {
      window: [
        {
          source_id: 'act-1',
          source_table: 'work_item_acts',
          radicado: '05001333301020230019900',
          work_item_title: 'Caso A',
          text: 'Auto resuelve excepciones',
          date: '2026-08-01',
        },
      ],
      forward: [],
    };
    const out = sanitizeDigest(
      {
        greeting: 'Buenos días',
        summary_body: 'Resumen',
        highlights: [
          { icon: '⚖️', text: 'Auto resuelve excepciones en 05001333301020230019900' },
          { icon: '📄', text: 'Novedad en 11001310300520190011100' },
        ],
        closing: 'Saludos',
      },
      facts,
    );
    expect(out.highlights).toHaveLength(1);
    expect(out.highlights[0].text).toContain('05001333301020230019900');
  });
});
