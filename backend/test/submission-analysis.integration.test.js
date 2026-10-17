const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { DashboardService } = require('../src/services/DashboardService');

process.env.NODE_ENV = 'test';
process.env.BLUR_THRESHOLD = '0.01';
const slots = ['front', 'right_side', 'rear', 'left_side'];
const candidate = { label_id: 0, label: 'Scratched', confidence: 0.9, bbox_xyxy: [2, 2, 40, 40] };
const clean = { detections: [], vlm: { status: 'skipped_no_candidates', verifications: [] } };
const detected = { detections: [candidate], vlm: { status: 'success', verifications: [
  { candidate_id: 1, source_index: 0, is_damage: true, damage_type: 'scratch', confidence: 0.95, reason: 'Visible scratch' }
] } };
const aiResponse = result => ({ ok: true, json: async () => result });

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-submission-analysis-'));
  const repo = new DatabaseRepository(path.join(root, 'test.db'));
  const service = new DashboardService(repo, path.join(root, 'uploads'));
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; service.close(); repo.close(); });
  global.fetch = async () => aiResponse({ success: true, bbox_xyxy: [0, 0, 64, 64], confidence: 0.95, class_id: 0 });
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    pixels.fill(((x + y) % 2) * 255, (y * 64 + x) * 3, (y * 64 + x) * 3 + 3);
  }
  const image = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  const photos = [];
  for (const slot of slots) {
    const result = await service.handleQualityCheckAction({ rentalId: 'R-ANALYSIS', plate: 'TEST-001', phase: 'pickup', slot,
      filename: 'vehicle.png', imageData: `data:image/png;base64,${image.toString('base64')}` }, 101);
    photos.push({ slot, photoId: result.photoId });
  }
  const body = { rentalId: 'R-ANALYSIS', plate: 'TEST-001', phase: 'pickup', photos };
  return { repo, service, photos, body };
}

test('submission waits for server analysis and never treats failure as clear', async t => {
  await t.test('missing results cannot be bypassed with client-supplied success', async t => {
    const { repo, service, body, photos } = await fixture(t);
    await assert.rejects(service.handlePhotoSubmissionAction({ ...body, damageSummary: { unavailable_photo_count: 0 },
      photos: photos.map(photo => ({ ...photo, damage: { inference_status: 'success', damage_status: 'none' } })) }, 101),
    error => error.status === 409 && error.code === 'ANALYSIS_PENDING');
    assert.equal(repo.getPhotoSubmissions().length, 0);
    assert.ok(photos.every(photo => !repo.getUploadedPhotoById(photo.photoId).submission_id));
  });

  await t.test('all successful clean results produce clear and survive persistence', async t => {
    const { repo, service, body, photos } = await fixture(t);
    global.fetch = async () => aiResponse(clean);
    for (const photo of photos) await service.handleConditionCheckAction(photo, 101);
    const result = await service.handlePhotoSubmissionAction(body, 101);
    assert.equal(result.overallStatus, 'ok');
    assert.equal(result.submission.status, 'clear');
    assert.equal(result.createdIncidents.length, 0);
    assert.equal(repo.getPhotoSubmissionDetail(result.submissionId).overall_status, 'ok');
    await assert.rejects(service.handleConditionCheckAction(photos[0], 101),
      error => error.status === 409 && error.code === 'PHOTO_ALREADY_SUBMITTED');
  });

  await t.test('disabled, unavailable, timeout and failed verification require human review', async t => {
    const { repo, service, body, photos } = await fixture(t);
    for (const [index, status] of ['disabled', 'unavailable', 'timeout', 'failed'].entries()) {
      global.fetch = async () => aiResponse({ detections: [candidate], vlm: { status, failure_reason: status, verifications: [] } });
      await service.handleConditionCheckAction(photos[index], 101);
    }
    const result = await service.handlePhotoSubmissionAction(body, 101);
    assert.equal(result.overallStatus, 'review_required');
    assert.equal(result.submission.status, 'review_required');
    assert.equal(result.damageSummary.unavailable_photo_count, 4);
    assert.equal(result.createdIncidents.length, 0);
    assert.match(result.submission.aiSummary, /human review is required/);
    assert.doesNotMatch(result.submission.aiSummary, /no damage|no new damage/i);
    assert.equal(repo.getPhotoSubmissionDetail(result.submissionId).overall_status, 'review_required');
    const replay = await service.handlePhotoSubmissionAction(body, 101);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.overallStatus, 'review_required');
  });

  await t.test('partial failure still creates an incident for confirmed damage', async t => {
    const { repo, service, body, photos } = await fixture(t);
    for (const [index, photo] of photos.entries()) {
      global.fetch = async () => { if (index === 1) throw new Error('offline'); return aiResponse(index === 0 ? detected : clean); };
      await service.handleConditionCheckAction(photo, 101);
    }
    const result = await service.handlePhotoSubmissionAction(body, 101);
    assert.equal(result.overallStatus, 'review_required');
    assert.equal(result.damageSummary.unavailable_photo_count, 1);
    assert.equal(result.createdIncidents.length, 1);
    assert.equal(result.submission.status, 'incident_created');
    assert.match(result.submission.aiSummary, /one incident created.*human review is required/);
    assert.equal(repo.getNotifications().length, 1);
  });

  await t.test('a slow retry cannot submit a stale failure or lose a late damage incident', async t => {
    const { repo, service, body, photos } = await fixture(t);
    global.fetch = async () => aiResponse(clean);
    for (const photo of photos.slice(1)) await service.handleConditionCheckAction(photo, 101);
    global.fetch = async () => { throw new Error('offline'); };
    await service.handleConditionCheckAction(photos[0], 101);
    let release;
    let started;
    const inFlight = new Promise(resolve => { started = resolve; });
    const response = new Promise(resolve => { release = resolve; });
    global.fetch = async () => { started(); return response; };
    const checking = service.handleConditionCheckAction(photos[0], 101);
    try {
      await inFlight;
      await assert.rejects(service.handlePhotoSubmissionAction(body, 101), error => error.code === 'ANALYSIS_PENDING');
      await assert.rejects(service.handleConditionCheckAction(photos[0], 101), error => error.code === 'ANALYSIS_PENDING');
      assert.equal(repo.getPhotoSubmissions().length, 0);
    } finally {
      release(aiResponse(detected));
      await checking;
    }
    const result = await service.handlePhotoSubmissionAction(body, 101);
    assert.equal(result.overallStatus, 'warning');
    assert.equal(result.createdIncidents.length, 1);
    assert.equal(result.damageSummary.unavailable_photo_count, 0);
  });
});

test('customer submission readiness and result labels distinguish pending and failed analysis', () => {
  const filename = path.resolve(__dirname, '../../frontend/src/utils/inspectionStatus.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const logic = {};
  vm.runInNewContext(compiled.outputText, { exports: logic });
  const { photoInspectionStatus, canSubmitInspectedPhotos, submissionInspectionStatus, INSPECTION_LABELS } = logic;
  const photos = Object.fromEntries(slots.map(slot => [slot, { status: 'passed', photoId: slot, quality: { passed: true, blur: { passed: true } } }]));
  assert.equal(canSubmitInspectedPhotos(slots, photos), false, 'quality alone does not enable submit');
  assert.equal(photoInspectionStatus(undefined), 'processing');
  for (const slot of slots) photos[slot].damage = { inference_status: 'success', damage_status: 'none' };
  assert.equal(canSubmitInspectedPhotos(slots, photos), true);
  photos.front.damage = { inference_status: 'failed', damage_status: 'unavailable' };
  assert.equal(canSubmitInspectedPhotos(slots, photos), true, 'terminal failure may submit for human review');
  assert.equal(photoInspectionStatus(photos.front.damage), 'review_required');
  photos.front = { status: 'checking' };
  assert.equal(canSubmitInspectedPhotos(slots, photos), false, 'replacing a photo invalidates readiness');
  assert.equal(submissionInspectionStatus('ok', 1), 'review_required', 'old responses with failed photos cannot turn green');
  assert.equal(submissionInspectionStatus('ok'), 'clear');
  assert.equal(submissionInspectionStatus('warning'), 'detected');
  assert.equal(submissionInspectionStatus('processing'), 'processing');
  assert.equal(submissionInspectionStatus('review_required'), 'review_required');
  assert.equal(INSPECTION_LABELS.review_required, '待人工確認');
});
