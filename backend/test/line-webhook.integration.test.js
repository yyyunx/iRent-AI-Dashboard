const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { NotificationService } = require('../src/services/NotificationService');

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

test('LINE webhook verifies signatures and captures a group message groupId', async t => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.LINE_CHANNEL_SECRET;
  const previousAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const previousTargetId = process.env.LINE_TARGET_ID;
  const secret = 'test-line-channel-secret';
  const accessToken = 'test-line-channel-access-token';
  const groupId = 'C0123456789abcdef0123456789abcdef';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-line-webhook-'));
  const logs = [];
  const originalInfo = console.info;

  process.env.NODE_ENV = 'development';
  process.env.LINE_CHANNEL_SECRET = secret;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = accessToken;
  delete process.env.LINE_TARGET_ID;
  console.info = (...args) => logs.push(args.join(' '));

  const app = createApp(path.join(tempDir, 'test.db'), path.join(tempDir, 'uploads'));
  t.after(() => {
    app.locals.databaseRepository.close();
    console.info = originalInfo;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = previousSecret;
    if (previousAccessToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = previousAccessToken;
    if (previousTargetId === undefined) delete process.env.LINE_TARGET_ID;
    else process.env.LINE_TARGET_ID = previousTargetId;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const body = JSON.stringify({
    destination: 'U0123456789abcdef0123456789abcdef',
    events: [{
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'group', groupId, userId: 'Ufedcba9876543210fedcba9876543210' },
      message: { id: '1', type: 'text', text: '取得群組 ID' }
    }]
  });

  await t.test('rejects a request with an invalid signature before processing events', async () => {
    await request(app).post('/api/line/webhook')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', 'not-a-valid-signature')
      .send(body)
      .expect(401);
    assert.deepEqual(logs, []);
    assert.equal(app.locals.databaseRepository.getSetting('lineLastWebhookTargetId'), '');
  });

  await t.test('accepts a signed group message and logs the groupId in development', async () => {
    const response = await request(app).post('/api/line/webhook')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', sign(body, secret))
      .send(body)
      .expect(200);

    assert.deepEqual(response.body, { ok: true, capturedTargets: 1 });
    assert.deepEqual(logs, [`[LINE] groupId: ${groupId}`]);
    assert.equal(app.locals.databaseRepository.getSetting('lineLastWebhookTargetId'), groupId);
    assert.equal(app.locals.databaseRepository.getSetting('lineLastWebhookSourceType'), 'group');
    assert.equal(app.locals.databaseRepository.getSetting('lineTargetId'), groupId);
    assert.equal(JSON.stringify(response.body).includes(secret), false);
  });

  await t.test('fails closed when LINE_CHANNEL_SECRET is missing', async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    await request(app).post('/api/line/webhook')
      .set('Content-Type', 'application/json')
      .set('x-line-signature', sign(body, secret))
      .send(body)
      .expect(503);
    process.env.LINE_CHANNEL_SECRET = secret;
  });

  await t.test('exposes configuration status but never the LINE credentials', () => {
    const config = new NotificationService(app.locals.databaseRepository).getConfig();
    const serialized = JSON.stringify(config);
    assert.equal(config.tokenConfigured, true);
    assert.equal(config.webhookConfigured, true);
    assert.equal(serialized.includes(accessToken), false);
    assert.equal(serialized.includes(secret), false);
    assert.equal('accessToken' in config, false);
    assert.equal('channelSecret' in config, false);
  });
});
