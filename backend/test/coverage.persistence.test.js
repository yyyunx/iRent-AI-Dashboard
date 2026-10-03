const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('ts-node/register');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { calculateCoverage, normalizeGuidance } = require('../src/services/Coverage');

test('server coverage summary is derived from saved per-photo guidance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-coverage-'));
  const repo = new DatabaseRepository(path.join(dir, 'test.sqlite'));
  try {
    for (const [photoId, slot] of [['p1', 'front'], ['p2', 'right_side'], ['p3', 'rear']]) {
      repo.insertUploadedPhoto({
        photo_id: photoId, rental_id: 'r1', plate: 'ABC-1234', phase: 'return', slot,
        filename: `${photoId}.jpg`, quality_passed: 1, is_blur: 0, plate_visible: 1,
        angle_valid: 1, distance_valid: 1, user_id: 7,
      });
    }
    repo.updatePhotoGuidance('p1', normalizeGuidance({ guidance_status: 'FULL', solver_used: 'EPNP', view_sector: 'FRONT' }), 7);
    repo.updatePhotoGuidance('p2', normalizeGuidance({ guidance_status: 'DEGRADED', solver_used: 'AP3P', view_sector: 'RIGHT' }), 7);
    repo.updatePhotoGuidance('p3', normalizeGuidance({ guidance_status: 'UNAVAILABLE', solver_used: 'NONE', view_sector: null }), 7);
    const saved = ['p1', 'p2', 'p3'].map(id => JSON.parse(repo.getUploadedPhotoById(id).ai_result_json).guidance);
    const summary = calculateCoverage(saved);
    assert.deepEqual(summary.covered_sectors, ['FRONT', 'RIGHT']);
    assert.equal(summary.coverage_percentage, 25);
    assert.equal(summary.next_view_recommendation, 'FRONT_RIGHT');
  } finally {
    repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
