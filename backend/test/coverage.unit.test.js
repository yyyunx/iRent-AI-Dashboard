const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { calculateCoverage, normalizeGuidance } = require('../src/services/Coverage');

const full = sector => normalizeGuidance({ guidance_status: 'FULL', solver_used: 'EPNP', view_sector: sector });

test('duplicate sectors do not increase coverage', () => {
  assert.equal(calculateCoverage([full('FRONT'), full('FRONT')]).coverage_percentage, 12.5);
});

test('different sectors form a stable union and next view', () => {
  const summary = calculateCoverage([full('FRONT'), full('RIGHT')]);
  assert.deepEqual(summary.covered_sectors, ['FRONT', 'RIGHT']);
  assert.equal(summary.next_view_recommendation, 'FRONT_RIGHT');
});

test('degraded contributes one coarse sector and unavailable contributes none', () => {
  const degraded = normalizeGuidance({ guidance_status: 'DEGRADED', solver_used: 'AP3P', view_sector: 'LEFT', covered_sectors: ['LEFT', 'REAR_LEFT'] });
  const unavailable = normalizeGuidance({ guidance_status: 'UNAVAILABLE', solver_used: 'NONE', view_sector: 'REAR' });
  assert.deepEqual(degraded.covered_sectors, ['LEFT']);
  assert.deepEqual(unavailable.covered_sectors, []);
  assert.equal(calculateCoverage([degraded, unavailable]).coverage_percentage, 12.5);
});
