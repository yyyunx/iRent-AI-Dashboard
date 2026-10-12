const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/auth/AuthService');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.BLUR_THRESHOLD = '0.01';

async function imageData() {
  const width = 96; const height = 96; const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = ((Math.floor(x / 6) + Math.floor(y / 6)) % 2) * 255;
    const index = (y * width + x) * 3;
    pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value;
  }
  const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function orientedImageData(orientation) {
  const width = 96; const height = 64; const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) * 255;
    const index = (y * width + x) * 3;
    pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value;
  }
  const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().withMetadata({ orientation }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

test('CustomerFlow request path reaches DamageNet and maps Qwen verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-customer-flow-damage-'));
  const dbPath = path.join(root, 'test.db');
  const uploadDir = path.join(root, 'uploads');
  const password = 'Correct-Horse-Battery-42!';
  const setupRepo = new DatabaseRepository(dbPath);
  const setupAuth = new AuthService(setupRepo);
  await setupAuth.createUser('customer01', password, 'user');
  setupRepo.close();

  const calls = [];
  const aiImageSizes = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push(String(url));
    const imageDataUrl = JSON.parse(options.body).image_data;
    const imageBuffer = Buffer.from(imageDataUrl.split(',', 2)[1], 'base64');
    const metadata = await sharp(imageBuffer).metadata();
    aiImageSizes.push({ width: metadata.width, height: metadata.height, orientation: metadata.orientation });
    if (String(url).endsWith('/v1/vehicle-gate')) return { ok: true, json: async () => ({ success: true, bbox_xyxy: [1, 1, 90, 90], confidence: 0.95, class_id: 0 }) };
    if (String(url).endsWith('/v1/damage')) return { ok: true, json: async () => ({
      detections: [{ label_id: 0, label: 'Scratched', confidence: 0.82, bbox_xyxy: [10, 12, 50, 52] }],
      vlm: { status: 'success', model: 'Qwen/Qwen2.5-VL-3B-Instruct', failure_reason: null, verifications: [
        { candidate_id: 1, source_index: 0, is_damage: true, damage_type: 'scratch', confidence: 0.93, reason: 'Visible scratch.' }
      ] }
    }) };
    throw new Error(`Unexpected AI request: ${url}`);
  };

  const app = createApp(dbPath, uploadDir);
  const agent = request.agent(app);
  try {
    const initialCsrf = await agent.get('/api/auth/csrf').expect(200);
    const login = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', initialCsrf.body.csrfToken)
      .send({ username: 'customer01', password })
      .expect(200);
    const csrfToken = login.body.csrfToken;
    const quality = await agent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', csrfToken)
      .send({ rentalId: 'R-WIRING', plate: 'TEST-001', phase: 'return', slot: 'front', filename: 'damage.jpg', imageData: await orientedImageData(6) })
      .expect(200);
    const condition = await agent.post('/api/photos/condition-check')
      .set('X-CSRF-Token', csrfToken)
      .send({ photoId: quality.body.photoId })
      .expect(200);

    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/vehicle-gate', '/v1/damage']);
    assert.deepEqual(aiImageSizes, [
      { width: 64, height: 96, orientation: undefined },
      { width: 64, height: 96, orientation: undefined }
    ]);
    assert.equal(condition.body.damage.damage_status, 'detected');
    assert.equal(condition.body.damage.events.length, 1);
    assert.equal(condition.body.damage.events[0].damage.verification.is_damage, true);
    assert.deepEqual(condition.body.damage.events[0].image, { width: 64, height: 96 });
  } finally {
    global.fetch = originalFetch;
    app.locals.databaseRepository.close();
  }
});
