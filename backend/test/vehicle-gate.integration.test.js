const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { DashboardService } = require('../src/services/DashboardService');
const { DashboardController } = require('../src/controllers/DashboardController');

process.env.NODE_ENV = 'test';
process.env.BLUR_THRESHOLD = '0.01';

async function clearImageData() {
  const width = 96; const height = 96; const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = ((Math.floor(x / 6) + Math.floor(y / 6)) % 2) * 255;
    const index = (y * width + x) * 3;
    pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value;
  }
  const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

test('vehicle input gate accepts vehicle bboxes and rejects no-bbox images before persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-vehicle-gate-'));
  const uploadDir = path.join(root, 'uploads');
  const repo = new DatabaseRepository(path.join(root, 'test.db'));
  const service = new DashboardService(repo, uploadDir);
  const originalFetch = global.fetch;
  const imageData = await clearImageData();
  try {
    let gateResult = { success: true, bbox_xyxy: [4, 5, 90, 91], confidence: 0.88, class_id: 0 };
    global.fetch = async (url) => {
      assert.match(String(url), /\/v1\/vehicle-gate$/);
      return { ok: true, json: async () => gateResult };
    };

    const accepted = await service.handleQualityCheckAction({ imageData, slot: 'front', filename: 'vehicle.png' }, 101);
    assert.equal(accepted.quality.passed, true);
    assert.ok(repo.getUploadedPhotoById(accepted.photoId));
    assert.equal(fs.readdirSync(uploadDir).length, 1);

    gateResult = { success: true, bbox_xyxy: [45, 45, 55, 55], confidence: 0.50, class_id: 0 };
    await service.handleQualityCheckAction({ imageData, slot: 'right_side', filename: 'small-vehicle.png' }, 101);
    gateResult = { success: true, bbox_xyxy: [2, 3, 92, 93], confidence: 0.91, class_id: 0 };
    await service.handleQualityCheckAction({ imageData, slot: 'left_side', filename: 'multi-vehicle.png' }, 101);

    gateResult = { success: false, reason: 'NO_VEHICLE_DETECTED', bbox_xyxy: [10.65, 0, 1234.44, 744.78], confidence: 0.242827, class_id: 0 };
    await assert.rejects(
      service.handleQualityCheckAction({ imageData, slot: 'rear', filename: 'low-confidence-false-positive.png' }, 101),
      error => error.code === 'NO_VEHICLE_DETECTED'
    );

    gateResult = { success: false, reason: 'NO_VEHICLE_DETECTED', bbox_xyxy: null, confidence: null, class_id: null };
    for (const filename of ['empty-scene.png', 'no-bbox.png']) {
      await assert.rejects(
        service.handleQualityCheckAction({ imageData, slot: 'rear', filename }, 101),
        error => error.code === 'NO_VEHICLE_DETECTED' && error.message === '未偵測到足夠清晰的車輛，請重新拍攝，確保車輛完整入鏡且光線充足。'
      );
    }
    assert.equal(repo.getUploadedPhotos().length, 3);
    assert.equal(fs.readdirSync(uploadDir).length, 3);

    const controller = new DashboardController(repo, service, uploadDir);
    let statusCode = 200; let body;
    const response = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; }
    };
    await controller.runQualityCheck({ body: { imageData, slot: 'rear', filename: 'no-bbox.png' }, authUser: { id: 101 } }, response);
    assert.equal(statusCode, 422);
    assert.deepEqual(body, {
      ok: false,
      error: { code: 'NO_VEHICLE_DETECTED', message: '未偵測到足夠清晰的車輛，請重新拍攝，確保車輛完整入鏡且光線充足。' }
    });
  } finally {
    global.fetch = originalFetch;
    repo.close();
  }
});
