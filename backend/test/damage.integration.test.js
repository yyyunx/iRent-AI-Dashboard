const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { DashboardService } = require('../src/services/DashboardService');

process.env.NODE_ENV = 'test';
process.env.BLUR_THRESHOLD = '0.01';
const SLOTS = ['front', 'right_side', 'rear', 'left_side', 'front_interior', 'backseat_interior'];

async function imageData() {
  const width = 96; const height = 96; const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = ((Math.floor(x / 6) + Math.floor(y / 6)) % 2) * 255;
    const i = (y * width + x) * 3; pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value;
  }
  return `data:image/png;base64,${(await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()).toString('base64')}`;
}

test('DamageNet production persistence and submission data flow', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-damage-'));
  const repo = new DatabaseRepository(path.join(root, 'test.db'));
  const service = new DashboardService(repo, path.join(root, 'uploads'));
  const originalFetch = global.fetch;
  const data = await imageData();
  const uploaded = [];
  for (const slot of SLOTS) uploaded.push(await service.handleQualityCheckAction({
    rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', slot,
    filename: slot === 'front' ? 'scratch-scenario-name.png' : `${slot}.png`, imageData: data
  }, 101));

  try {
    let nextDetections = [{ label_id: 0, label: 'Scratched', confidence: 0.91, bbox_xyxy: [1, 2, 30, 40] }];
    global.fetch = async () => ({ ok: true, json: async () => ({ detections: nextDetections }) });

    await t.test('success persists under the owned photoId and preserves guidance', async () => {
      repo.updatePhotoGuidance(uploaded[0].photoId, { guidance_status: 'FULL', covered_sectors: ['FRONT'] }, 101);
      const result = await service.handleConditionCheckAction({ photoId: uploaded[0].photoId, imageData: 'client-data-is-ignored' }, 101);
      assert.equal(result.damage.damage_status, 'detected');
      const saved = JSON.parse(repo.getUploadedPhotoById(uploaded[0].photoId).ai_result_json);
      assert.equal(saved.damage.photoId, uploaded[0].photoId);
      assert.equal(saved.damage.detection_count, 1);
      assert.equal(saved.guidance.guidance_status, 'FULL');
    });

    await t.test('multiple photos keep independent results', async () => {
      nextDetections = [];
      await service.handleConditionCheckAction({ photoId: uploaded[1].photoId }, 101);
      const first = JSON.parse(repo.getUploadedPhotoById(uploaded[0].photoId).ai_result_json).damage;
      const second = JSON.parse(repo.getUploadedPhotoById(uploaded[1].photoId).ai_result_json).damage;
      assert.equal(first.damage_status, 'detected');
      assert.equal(second.damage_status, 'none');
      assert.notEqual(first.photoId, second.photoId);
    });

    await t.test('ownership is enforced before inference', async () => {
      await assert.rejects(() => service.handleConditionCheckAction({ photoId: uploaded[0].photoId }, 202), error => error.status === 404);
    });

    await t.test('inference failure is persisted as unavailable and does not block submission', async () => {
      global.fetch = async () => { throw new Error('offline'); };
      const failed = await service.handleConditionCheckAction({ photoId: uploaded[2].photoId }, 101);
      assert.equal(failed.damage.inference_status, 'failed');
      assert.equal(failed.damage.failure_reason, 'AI_SERVICE_ERROR');
    });

    global.fetch = async () => ({ ok: true, json: async () => ({ detections: [] }) });
    for (let index = 3; index < uploaded.length; index++) await service.handleConditionCheckAction({ photoId: uploaded[index].photoId }, 101);
    // A second damaged photo must be folded into the same incident.
    global.fetch = async () => ({ ok: true, json: async () => ({ detections: [
      { label_id: 0, label: 'Scratched', confidence: 0.9, bbox_xyxy: [1, 2, 30, 40] },
      { label_id: 1, label: 'Dented', confidence: 0.8, bbox_xyxy: [40, 40, 60, 60] }
    ] }) });
    await service.handleConditionCheckAction({ photoId: uploaded[3].photoId }, 101);

    await t.test('final summary comes from saved server results and scenario filenames are ignored', async () => {
      const photos = uploaded.map((item, index) => ({ slot: SLOTS[index], photoId: item.photoId, filename: index === 0 ? 'clean.png' : 'damage-client-claim.png', damageDetected: false }));
      const result = await service.handlePhotoSubmissionAction({ rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', photos, damageSummary: { detected_photo_count: 999 } }, 101);
      assert.equal(result.damageSummary.detected_photo_count, 2);
      assert.equal(result.damageSummary.unavailable_photo_count, 1);
      assert.equal(result.createdIncidents.length, 1);
      assert.equal(result.incidents[0].issueCount, 3);
      assert.equal(result.incidents[0].urgencyScore, 7);
      assert.equal(result.incidents[0].status, 'todo');
      assert.equal(result.incidents[0].sourceSubmissionId, result.submissionId);
      assert.equal(repo.getTimelines()[result.createdIncidents[0]].filter(row => row.event_type === 'photo_ai_analysis').length, 2);
      assert.equal(repo.getNotifications().filter(row => row.incident_id === result.createdIncidents[0]).length, 1);
      await assert.rejects(() => service.handlePhotoSubmissionAction({ rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', photos }, 101), error => error.status === 422);
      const savedSubmission = repo.getPhotoSubmissionDetail(result.submissionId);
      assert.deepEqual(JSON.parse(savedSubmission.damage_summary_json), result.damageSummary);
      const savedPhoto = JSON.parse(repo.getUploadedPhotoById(uploaded[0].photoId).ai_result_json);
      assert.equal(savedPhoto.damage.damage_status, 'detected');
      assert.equal(savedPhoto.guidance.guidance_status, 'FULL');
      assert.equal('conditionScenario' in savedPhoto, false);
    });
  } finally {
    global.fetch = originalFetch;
    repo.close();
  }
});
