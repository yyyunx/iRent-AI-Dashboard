// Disposable DB/uploads. Never load runtime .env or send external notifications.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const sharp = require('sharp');
const { performance } = require('node:perf_hooks');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/auth/AuthService');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-api-benchmark-'));
  const iterations = 20;
  Object.assign(process.env, { NODE_ENV: 'test', LINE_CHANNEL_ACCESS_TOKEN: '', LINE_TARGET_ID: '', LINE_CHANNEL_SECRET: 'benchmark-only-secret', GEMINI_API_KEY: '', GEMINI_API_KEY_FILE: path.join(root, 'absent-key'), BLUR_THRESHOLD: '0.01' });
  const originalFetch = global.fetch;
  // AI stub timings include adapter overhead, but exclude real inference/network.
  global.fetch = async url => {
    if (String(url).endsWith('/v1/damage')) return { ok: true, json: async () => ({ detections: [{ label_id: 0, label: 'Scratched', confidence: 0.91, bbox_xyxy: [1, 2, 30, 40] }] }) };
    if (String(url).endsWith('/v1/guidance')) return { ok: true, json: async () => ({ schema_version: 'altis-guidance.v1', guidance_status: 'FULL', covered_sectors: ['FRONT'], success: true }) };
    throw new Error('External services disabled in benchmark');
  };
  const app = createApp(path.join(root, 'benchmark.db'), path.join(root, 'uploads'));
  const repo = app.locals.databaseRepository;
  repo.setSetting('lineNotificationEnabled', 'false');
  const rows = [];
  try {
    const password = 'Benchmark-Only-Password-42!';
    await new AuthService(repo).createUser('benchmark-admin', password, 'admin');
    const admin = repo.getUserByUsername('benchmark-admin');
    const agent = request.agent(app);
    let csrfToken;
    const get = route => agent.get(route);
    const post = (route, body) => agent.post(route).set('X-CSRF-Token', csrfToken).send(body);
    const login = async () => {
      const csrf = await get('/api/auth/csrf');
      const response = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ username: admin.username, password });
      csrfToken = response.body.csrfToken;
      return response;
    };
    async function measure(endpoint, run, expected = 200, note = 'local processing', prepare) {
      const timings = []; let responseBytes = 0;
      for (let index = 0; index < iterations; index++) {
        const fixture = prepare ? await prepare(index) : undefined;
        const started = performance.now();
        const response = await run(fixture);
        timings.push(performance.now() - started);
        if (response.status !== expected) throw new Error(`${endpoint}: expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`);
        responseBytes = response.body ? Buffer.byteLength(JSON.stringify(response.body)) : response.text?.length || 0;
      }
      timings.sort((a, b) => a - b);
      const round = value => Math.round(value * 10) / 10;
      rows.push({ endpoint, status: expected, samples: iterations, avgMs: round(timings.reduce((a, b) => a + b) / iterations), p50Ms: round(timings[Math.ceil(iterations * 0.5) - 1]), p95Ms: round(timings[Math.ceil(iterations * 0.95) - 1]), maxMs: round(timings.at(-1)), responseBytes, note });
    }
    await measure('GET /healthz', () => get('/healthz'));
    await measure('GET /api/auth/csrf', async () => { const response = await get('/api/auth/csrf'); csrfToken = response.body.csrfToken; return response; });
    await measure('POST /api/auth/login', async () => {
      const response = await agent.post('/api/auth/login').set('X-CSRF-Token', csrfToken).send({ username: admin.username, password });
      csrfToken = response.body.csrfToken; return response;
    });
    const pixels = Buffer.alloc(96 * 96 * 3);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) pixels.fill(((Math.floor(x / 6) + Math.floor(y / 6)) % 2) * 255, (y * 96 + x) * 3, (y * 96 + x) * 3 + 3);
    const imageData = `data:image/png;base64,${(await sharp(pixels, { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer()).toString('base64')}`;
    const upload = async (slot = 'front', rentalId = 'BENCH-RENTAL') => {
      const response = await post('/api/photos/quality-check', { rentalId, plate: 'BEN-1234', phase: 'pickup', slot, filename: `${slot}.png`, imageData });
      if (response.status !== 200) throw new Error('Photo fixture failed');
      return response.body;
    };
    const photo = await upload(); const other = await upload();
    const slots = ['front', 'right_side', 'rear', 'left_side', 'front_interior', 'backseat_interior'];
    const freshSubmission = async index => {
      const rentalId = `BENCH-${index}-${crypto.randomUUID()}`;
      const photos = [];
      for (const slot of slots) {
        const item = await upload(slot, rentalId);
        repo.updatePhotoCondition(item.photoId, { damage: { detected: true, type: 'scratch', confidence: 0.91 }, dirty: { detected: false }, persistedDamage: { schema_version: 'irent.damage.v1', photoId: item.photoId, damage_status: 'detected', detection_count: 1, detections: [{ label_id: 0, label: 'Scratched', confidence: 0.91, bbox_xyxy: [1, 2, 30, 40] }], confidence: 0.91, inference_status: 'success' } }, admin.id);
        photos.push({ slot, photoId: item.photoId });
      }
      return { rentalId, plate: 'BEN-1234', phase: 'pickup', photos };
    };
    let submissionId;
    await measure('POST /api/photo-submissions', async body => { const response = await post('/api/photo-submissions', body); submissionId = response.body.submissionId; return response; }, 200, 'six saved damage photos; fixture uploads excluded', freshSubmission);
    for (const route of ['/api/auth/me', '/api/state', '/api/incidents/map', '/api/operators', '/api/submissions', `/api/submissions/${submissionId}`, '/api/agent/operations', '/api/agent/history', '/api/performance', `/${photo.changedResource.data.filePath}`]) {
      await measure(`GET ${route.replace(submissionId, ':submissionId').replace(photo.changedResource.data.filePath, 'uploads/:filename')}`, () => get(route));
    }
    await measure('POST /api/photos/quality-check', () => post('/api/photos/quality-check', { rentalId: 'BENCH', plate: 'BEN-1234', phase: 'pickup', slot: 'front', filename: 'front.png', imageData }));
    await measure('POST /api/photos/orientation-check', () => post('/api/photos/orientation-check', { imageData }), 503, 'orientation unavailable; error path');
    await measure('POST /api/photos/capture-guidance', () => post('/api/photos/capture-guidance', { photoId: photo.photoId, imageData }), 200, 'AI stub; excludes inference/network');
    await measure('POST /api/photos/condition-check', () => post('/api/photos/condition-check', { photoId: photo.photoId }), 200, 'AI stub; excludes inference/network');
    await measure('POST /api/incidents', () => post('/api/incidents', { plate: 'NEW-1234', station: '台北站', type: 'cleaning', label: '清潔', severity: 'low', confidence: 90, x: 50, y: 50 }));
    const freshIncident = () => {
      const id = `INC-${crypto.randomBytes(12).toString('base64url')}`;
      repo.insertIncident({ id, plate: 'BEN-1234', station: '台北站', type: 'damage', label: '刮傷', severity: 'low', confidence: 91, status: 'pending_assignment' });
      return id;
    };
    for (const action of ['dispatch', 'assign_self', 'comment', 'in_progress', 'maintenance_report', 'resolve', 'reopen']) {
      await measure(`POST /api/action (${action})`, incidentId => post('/api/action', { action, incidentId, body: 'benchmark comment', note: 'completed' }), 200, 'LINE disabled; maintenance report has no completion photo', () => {
        const id = freshIncident();
        if (action === 'reopen') repo.updateIncidentStatusAndAssignee(id, 'resolved', 'closed');
        if (action === 'in_progress') repo.updateIncidentStatusAndAssignee(id, 'assigned', '北區小隊');
        if (action === 'maintenance_report') repo.updateIncidentStatusAndAssignee(id, 'in_progress', '北區小隊');
        if (action === 'resolve') repo.updateIncidentStatusAndAssignee(id, 'in_progress', '北區小隊');
        return id;
      });
    }
    await measure('POST /api/action (specified operator)', incidentId => post('/api/action', { action: 'dispatch', incidentId, assigneeUserId: admin.id }), 200, 'LINE disabled', freshIncident);
    await measure('POST /api/settings/line', () => post('/api/settings/line', { enabled: false, groupName: 'Benchmark' }));
    await measure('POST /api/settings/ai', () => post('/api/settings/ai', { clearApiKey: true }));
    await measure('POST /api/notifications/line/test', () => post('/api/notifications/line/test', { message: 'Benchmark only' }), 200, 'not_configured; no LINE push');
    for (const route of ['sop-query', 'audit-query']) await measure(`POST /api/agent/${route}`, () => post(`/api/agent/${route}`, { prompt: '派工 LINE 通知' }));
    await measure('POST /api/agent/query', () => post('/api/agent/query', { prompt: '分析車況' }), 400, 'Gemini unconfigured; error path');
    await measure('POST /api/agent/photo-compare', () => post('/api/agent/photo-compare', { beforePhotoId: photo.photoId, afterPhotoId: other.photoId }), 400, 'Gemini unconfigured; error path');
    for (const type of ['dispatch', 'line']) await measure(`POST /api/agent/${type}-drafts`, incidentId => post(`/api/agent/${type}-drafts`, { incidentId }), 200, 'local draft generation', freshIncident);
    await measure('POST /api/agent/action-drafts/:draftId/confirm', draftId => post(`/api/agent/action-drafts/${draftId}/confirm`, {}), 200, 'LINE disabled; draft setup excluded', async () => {
      const response = await post('/api/agent/line-drafts', { incidentId: freshIncident() });
      return response.body.draft.id;
    });
    const webhook = JSON.stringify({ events: [] });
    const signature = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(webhook).digest('base64');
    await measure('POST /api/line/webhook', () => agent.post('/api/line/webhook').set('Content-Type', 'application/json').set('x-line-signature', signature).send(webhook));
    await measure('POST /api/auth/logout', () => post('/api/auth/logout', {}), 200, 'login setup excluded', login);
    const report = { measuredAt: new Date().toISOString(), fixture: 'disposable SQLite, synthetic 96x96 PNG, single sequential client', measurement: 'local HTTP request/response elapsed ms; includes transport and middleware; no warmup', externalServices: 'LINE disabled; Gemini unconfigured; DamageNet/KptNet stubbed; not production latency', iterations, rows: rows.sort((a, b) => b.p95Ms - a.p95Ms) };
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    global.fetch = originalFetch;
    repo.close();
    // Target is exactly the mkdtemp path created above, never runtime outputs.
    if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('irent-api-benchmark-')) fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
