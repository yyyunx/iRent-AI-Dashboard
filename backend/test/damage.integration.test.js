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
  global.fetch = async () => ({ ok: true, json: async () => ({ success: true, bbox_xyxy: [1, 1, 90, 90], confidence: 0.9, class_id: 0 }) });
  const data = await imageData();
  const uploaded = [];
  for (const slot of SLOTS) uploaded.push(await service.handleQualityCheckAction({
    rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', slot,
    filename: slot === 'front' ? 'scratch-scenario-name.png' : `${slot}.png`, imageData: data
  }, 101));

  try {
    let nextDetections = [
      { label_id: 0, label: 'Scratched', confidence: 0.91, bbox_xyxy: [1, 2, 30, 40] },
      { label_id: 1, label: 'Dented', confidence: 0.88, bbox_xyxy: [40, 10, 70, 50] }
    ];
    let nextVlm = { status: 'success', model: 'Qwen/Qwen2.5-VL-3B-Instruct', failure_reason: null, verifications: [
      { candidate_id: 2, source_index: 1, is_damage: false, damage_type: 'none', confidence: 0.97, reason: 'Normal panel contour.' },
      { candidate_id: 1, source_index: 0, is_damage: true, damage_type: 'scratch', confidence: 0.94, reason: 'Visible linear scratch.' }
    ] };
    global.fetch = async () => ({ ok: true, json: async () => ({ detections: nextDetections, vlm: nextVlm }) });

    await t.test('success persists under the owned photoId and preserves guidance', async () => {
      repo.updatePhotoGuidance(uploaded[0].photoId, {
        guidance_status: 'FULL', covered_sectors: ['FRONT'], success: true, inlier_ratio: 0.9,
        intrinsics: { focal_length_px: 38.4, principal_point_px: [16, 16] },
        pose_debug: { rotation_camera_to_object: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], camera_center_car_frame: [0, 0, -10] }
      }, 101);
      const result = await service.handleConditionCheckAction({ photoId: uploaded[0].photoId, imageData: 'client-data-is-ignored' }, 101);
      assert.equal(result.damage.damage_status, 'detected');
      const saved = JSON.parse(repo.getUploadedPhotoById(uploaded[0].photoId).ai_result_json);
      assert.equal(saved.damage.photoId, uploaded[0].photoId);
      assert.equal(saved.damage.detection_count, 2);
      assert.equal(saved.damage.events.length, 1);
      assert.equal(saved.damage.events[0].localization.failureReason, 'RAY_INTERSECTION_PENDING');
      assert.deepEqual(saved.damage.events[0].damage.center2D, [15.5, 21]);
      assert.equal(saved.damage.vlm.status, 'success');
      assert.equal(saved.damage.detections[0].verification.is_damage, true);
      assert.equal(saved.damage.detections[1].verification.is_damage, false);
      assert.equal(saved.damage.events[0].damage.verification.confidence, 0.94);
      assert.equal(saved.guidance.guidance_status, 'FULL');

      const localized = service.persistDamageLocalizations(uploaded[0].photoId, [{
        id: saved.damage.events[0].id,
        localization: { success: true, position3D: [0, 2, 0], vehiclePart: 'left_side' }
      }]);
      assert.equal(localized.events[0].localization.success, true);
      assert.equal(localized.events[0].localization.method, 'threejs_recursive_mesh_raycast');
    });

    await t.test('multiple photos keep independent results', async () => {
      nextDetections = [];
      nextVlm = { status: 'skipped_no_candidates', model: null, failure_reason: null, verifications: [] };
      await service.handleConditionCheckAction({ photoId: uploaded[1].photoId }, 101);
      const first = JSON.parse(repo.getUploadedPhotoById(uploaded[0].photoId).ai_result_json).damage;
      const second = JSON.parse(repo.getUploadedPhotoById(uploaded[1].photoId).ai_result_json).damage;
      assert.equal(first.damage_status, 'detected');
      assert.equal(second.damage_status, 'none');
      assert.equal(second.vlm.status, 'skipped_no_candidates');
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

    await t.test('Qwen failure states retain raw candidates but never publish unverified damage', async () => {
      nextDetections = [{ label_id: 1, label: 'Dented', confidence: 0.72, bbox_xyxy: [2, 3, 35, 44] }];
      for (const status of ['disabled', 'unavailable']) {
        nextVlm = { status, model: null, failure_reason: `QWEN_${status.toUpperCase()}`, verifications: [] };
        global.fetch = async () => ({ ok: true, json: async () => ({ detections: nextDetections, vlm: nextVlm }) });
        const fallback = await service.handleConditionCheckAction({ photoId: uploaded[3].photoId }, 101);
        assert.equal(fallback.damage.damage_status, 'unavailable');
        assert.equal(fallback.damage.events.length, 0);
        assert.equal(fallback.damage.detection_count, 1);
        assert.equal(fallback.damage.vlm.status, status);
      }
      nextVlm = { status: 'timeout', model: 'Qwen/Qwen2.5-VL-3B-Instruct', failure_reason: 'QWEN_TIMEOUT', verifications: [] };
      global.fetch = async () => ({ ok: true, json: async () => ({ detections: nextDetections, vlm: nextVlm }) });
      const timeout = await service.handleConditionCheckAction({ photoId: uploaded[3].photoId }, 101);
      assert.equal(timeout.damage.damage_status, 'unavailable');
      assert.equal(timeout.damage.events.length, 0);
      assert.equal(timeout.damage.vlm.status, 'timeout');

      nextVlm = { status: 'failed', model: 'Qwen/Qwen2.5-VL-3B-Instruct', failure_reason: 'QWEN_RESPONSE_INVALID:ValueError', verifications: [] };
      const malformed = await service.handleConditionCheckAction({ photoId: uploaded[4].photoId }, 101);
      assert.equal(malformed.damage.damage_status, 'unavailable');
      assert.equal(malformed.damage.events.length, 0);
      assert.equal(malformed.damage.vlm.status, 'failed');
    });

    await t.test('an explicit Qwen rejection removes a false-positive candidate', async () => {
      nextVlm = { status: 'success', model: 'Qwen/Qwen2.5-VL-3B-Instruct', failure_reason: null, verifications: [
        { candidate_id: 1, source_index: 0, is_damage: false, damage_type: 'none', confidence: 0.97, reason: 'Panel reflection.' }
      ] };
      const rejected = await service.handleConditionCheckAction({ photoId: uploaded[5].photoId }, 101);
      assert.equal(rejected.damage.damage_status, 'none');
      assert.equal(rejected.damage.detection_count, 1);
    });

    await t.test('optional legacy interior photos remain accepted and final summary uses saved server results', async () => {
      const photos = uploaded.map((item, index) => ({ slot: SLOTS[index], photoId: item.photoId, filename: index === 0 ? 'clean.png' : 'damage-client-claim.png', damageDetected: false }));
      const result = await service.handlePhotoSubmissionAction({ rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', photos, damageSummary: { detected_photo_count: 999 } }, 101);
      assert.equal(result.damageSummary.detected_photo_count, 1);
      assert.equal(result.damageSummary.unavailable_photo_count, 3);
      assert.equal(result.damageSummary.qwen_reviewed_photo_count, 2);
      assert.equal(result.damageSummary.qwen_fallback_photo_count, 3);
      assert.equal(result.createdIncidents.length, 1);
      const notifications = repo.getNotifications();
      assert.equal(notifications.length, 1, 'Qwen failures must remain explicit without sending extra LINE alerts');
      assert.equal(notifications[0].event_type, 'ai_detected');
      assert.equal(result.incidents[0].status, 'pending_assignment');
      assert.equal(result.incidents[0].sourceSubmissionId, result.submissionId);
      const replay = await service.handlePhotoSubmissionAction({ rentalId: 'R-DAMAGE', plate: 'AAA-0001', phase: 'pickup', photos: [...photos].reverse() }, 101);
      assert.equal(replay.submissionId, result.submissionId);
      assert.equal(replay.idempotentReplay, true);
      assert.deepEqual(replay.createdIncidents, result.createdIncidents);
      assert.equal(repo.getNotifications().filter(row => row.incident_id === result.createdIncidents[0]).length, 1);
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
