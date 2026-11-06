import { strict as assert } from 'node:assert';
import { redundantSamaiPublicationRoute } from './storedSamaiRead.ts';

const base = {
  connectorKey: 'SAMAI_ESTADOS', scope: 'PUBS',
  instanceBaseUrl: 'https://samai-fixture.invalid',
  instanceScope: 'PLATFORM', instanceOrganizationId: null,
  organizationRoute: false,
  nativeReadBaseUrl: 'https://samai-fixture.invalid',
};

Deno.test('same platform publication operation is redundant after a native read attempt', () => {
  assert.equal(redundantSamaiPublicationRoute(base), true);
  assert.equal(redundantSamaiPublicationRoute({
    ...base, instanceBaseUrl: 'https://SAMAI-fixture.invalid:443/',
  }), true);
});

for (const [name, change] of Object.entries({
  'native operation not attempted': { nativeReadBaseUrl: null },
  'different provider at same URL': { connectorKey: 'OTHER_PROVIDER' },
  'broader operation': { scope: 'BOTH' },
  'organization route': { organizationRoute: true },
  'BYO credentials': { instanceScope: 'ORGANIZATION', instanceOrganizationId: 'synthetic-org' },
  'organization instance mislabeled PLATFORM': { instanceOrganizationId: 'synthetic-org' },
  'missing instance ownership': { instanceOrganizationId: undefined },
  'missing instance scope': { instanceScope: undefined },
  'different service': { instanceBaseUrl: 'https://other-fixture.invalid' },
  'different service path': { instanceBaseUrl: 'https://samai-fixture.invalid/tenant' },
  'different port': { instanceBaseUrl: 'https://samai-fixture.invalid:8443' },
  'query-bound tenant': { instanceBaseUrl: 'https://samai-fixture.invalid?tenant=other' },
  'embedded credentials': { instanceBaseUrl: 'https://fixture-user@samai-fixture.invalid' },
  'fragment': { instanceBaseUrl: 'https://samai-fixture.invalid#other' },
  'non-HTTPS service': { instanceBaseUrl: 'http://samai-fixture.invalid' },
  'unparseable base': { instanceBaseUrl: 'not a URL' },
  'missing base': { instanceBaseUrl: undefined },
})) {
  Deno.test(`preserves route with ${name}`, () => {
    assert.equal(redundantSamaiPublicationRoute({ ...base, ...change }), false);
  });
}
