const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const request = require('supertest');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/auth/AuthService');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const express = require('express');
const { setAuthCookies } = require('../src/auth/cookies');
const { NotificationService } = require('../src/services/NotificationService');

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.ADDITIONAL_TRUSTED_ORIGINS = 'https://servers-billion-barbara-signatures.trycloudflare.com';
process.env.GEMINI_API_KEY = '';
// This suite verifies authorization and workflow gates. Laplacian score calibration has its
// own unit tests, so keep this generated fixture above the quality threshold.
process.env.BLUR_THRESHOLD = '0.01';
const nativeFetch = global.fetch;
global.fetch = async (url, options) => String(url).endsWith('/v1/vehicle-gate')
  ? { ok: true, json: async () => ({ success: true, bbox_xyxy: [1, 1, 90, 90], confidence: 0.9, class_id: 0 }) }
  : String(url).endsWith('/v1/damage')
    ? { ok: true, json: async () => ({ detections: [], vlm: { status: 'skipped_no_candidates', verifications: [] } }) }
    : nativeFetch(url, options);
const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOUlEQVR4nO3WywkAMBBCwaj995wqAjkM7F1Y/LyT7ukdAvWicVEEbaoi2rQGJyazqGLAq9BxX9P1BYyfGAFvvlyBAAAAAElFTkSuQmCC';
const REQUIRED_PHOTO_SLOTS = ['front', 'right_side', 'rear', 'left_side'];
let clearImageDataPromise;
let blurredImageDataPromise;

function createQualityFixture(flat = false) {
  const width = 96;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = flat ? 128 : ((Math.floor(x / 6) + Math.floor(y / 6)) % 2) * 255;
      const index = (y * width + x) * 3;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
    .then(buffer => `data:image/png;base64,${buffer.toString('base64')}`);
}

function clearImageData() {
  clearImageDataPromise ||= createQualityFixture(false);
  return clearImageDataPromise;
}

function blurredImageData() {
  blurredImageDataPromise ||= createQualityFixture(true);
  return blurredImageDataPromise;
}

function cookieValue(response, name) {
  const cookies = response.headers['set-cookie'] || [];
  const entry = cookies.find(value => value.startsWith(`${name}=`));
  return entry ? entry.split(';', 1)[0] : '';
}

async function csrf(agent) {
  const response = await agent.get('/api/auth/csrf').expect(200);
  assert.ok(response.body.csrfToken);
  return response.body.csrfToken;
}

async function login(agent, username, password) {
  const initialCsrf = await csrf(agent);
  const response = await agent.post('/api/auth/login')
    .set('X-CSRF-Token', initialCsrf)
    .send({ username, password })
    .expect(200);
  assert.ok(response.body.csrfToken);
  assert.equal(response.body.user.username, username.trim().toLowerCase());
  return response;
}

async function uploadValidatedPhotos(agent, csrfToken, data) {
  const imageData = await clearImageData();
  const photos = [];
  for (const slot of REQUIRED_PHOTO_SLOTS) {
    const response = await agent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', csrfToken)
      .send({
        ...data,
        slot,
        filename: slot === 'right_side' ? 'scratch.png' : `${slot}.png`,
        imageData
      })
      .expect(200);
    await agent.post('/api/photos/condition-check')
      .set('X-CSRF-Token', csrfToken)
      .send({ photoId: response.body.photoId })
      .expect(200);
    photos.push({ slot, photoId: response.body.photoId, filename: slot === 'right_side' ? 'scratch.png' : `${slot}.png` });
  }
  return photos;
}

test('authentication, RBAC, ownership, CSRF, and session revocation', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-auth-'));
  const dbPath = path.join(tempDir, 'test.db');
  const uploadDir = path.join(tempDir, 'uploads');
  const password = 'Correct-Horse-Battery-42!';

  const setupRepo = new DatabaseRepository(dbPath);
  const setupAuth = new AuthService(setupRepo);
  const admin = await setupAuth.createUser('admin01', password, 'admin');
  const userA = await setupAuth.createUser('user-a', password, 'user');
  const userB = await setupAuth.createUser('user-b', password, 'user');
  const disabled = await setupAuth.createUser('disabled-user', password, 'user', false);
  setupRepo.close();

  const app = createApp(dbPath, uploadDir);

  await t.test('CSRF accepts exact configured tunnel origin and rejects untrusted origins', async () => {
    const trustedAgent = request.agent(app);
    const trustedToken = await csrf(trustedAgent);
    await trustedAgent.post('/api/auth/login')
      .set('Origin', 'https://servers-billion-barbara-signatures.trycloudflare.com')
      .set('X-CSRF-Token', trustedToken)
      .send({ username: 'USER-A', password })
      .expect(200);

    const untrustedAgent = request.agent(app);
    const untrustedToken = await csrf(untrustedAgent);
    await untrustedAgent.post('/api/auth/login')
      .set('Origin', 'https://attacker.example')
      .set('X-CSRF-Token', untrustedToken)
      .send({ username: 'USER-A', password })
      .expect(403);
  });

  await t.test('login still rejects missing and incorrect CSRF tokens', async () => {
    const agent = request.agent(app);
    await csrf(agent);
    await agent.post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ username: 'USER-A', password })
      .expect(403);
    await agent.post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', 'forged-token')
      .send({ username: 'USER-A', password })
      .expect(403);
  });

  await t.test('legacy email schema receives an additive username migration without losing users', () => {
    const legacyPath = path.join(tempDir, 'legacy.db');
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(`
      CREATE TABLE User (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
    `);
    legacyDb.prepare(`
      INSERT INTO User(id, email, password_hash, role, is_active, created_at, updated_at)
      VALUES (7, 'Legacy.Admin@example.com', 'preserved-password-hash', 'admin', 1, '2026-01-01', '2026-01-01')
    `).run();
    legacyDb.close();

    const migratedRepo = new DatabaseRepository(legacyPath);
    const migrated = migratedRepo.getUserByUsername('LEGACY-ADMIN');
    assert.equal(migrated.id, 7);
    assert.equal(migrated.username, 'legacy-admin');
    assert.equal(migrated.password_hash, 'preserved-password-hash');
    assert.equal(migrated.role, 'admin');
    migratedRepo.close();

    const checkDb = new Database(legacyPath, { readonly: true });
    const columns = checkDb.prepare('PRAGMA table_info(User)').all().map(column => column.name);
    assert.ok(columns.includes('email'));
    assert.ok(columns.includes('username'));
    assert.equal(checkDb.prepare('SELECT COUNT(*) AS count FROM User').get().count, 1);
    checkDb.close();
  });

  await t.test('fresh User schema uses a unique username and has no email column', () => {
    const schemaDb = new Database(dbPath, { readonly: true });
    const columns = schemaDb.prepare('PRAGMA table_info(User)').all();
    const usernameColumn = columns.find(column => column.name === 'username');
    assert.ok(usernameColumn);
    assert.equal(usernameColumn.notnull, 1);
    assert.equal(columns.some(column => column.name === 'email'), false);
    const indexes = schemaDb.prepare('PRAGMA index_list(User)').all();
    assert.ok(indexes.some(index => index.unique === 1));
    schemaDb.close();
  });

  await t.test('anonymous request to protected API returns 401', async () => {
    await request(app).get('/api/state').expect(401);
  });

  const userAAgent = request.agent(app);
  const userALogin = await login(userAAgent, 'UsEr-A', password);
  let userACsrf = userALogin.body.csrfToken;

  await t.test('auth responses expose only safe user fields', async () => {
    assert.deepEqual(Object.keys(userALogin.body.user).sort(), ['id', 'role', 'username']);
    assert.equal(userALogin.body.user.username, 'user-a');
    assert.equal('sessionToken' in userALogin.body, false);
    assert.equal('password_hash' in userALogin.body.user, false);
    const me = await userAAgent.get('/api/auth/me').expect(200);
    assert.deepEqual(Object.keys(me.body.user).sort(), ['id', 'role', 'username']);
  });

  await t.test('valid username login is case-insensitive and returns the normalized username', async () => {
    const agent = request.agent(app);
    const response = await login(agent, 'USER-B', password);
    assert.equal(response.body.user.username, 'user-b');
    assert.equal(response.body.user.role, 'user');
  });

  await t.test('user cannot call an admin API or forge a frontend role', async () => {
    await userAAgent.post('/api/settings/line')
      .set('X-CSRF-Token', userACsrf)
      .send({ enabled: false })
      .expect(403);
    await userAAgent.post('/api/settings/line')
      .set('X-CSRF-Token', userACsrf)
      .send({ enabled: false, role: 'admin' })
      .expect(403);
  });

  await t.test('invalid CSRF is rejected', async () => {
    await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', 'forged-token')
      .send({ rentalId: 'R-CSRF', plate: 'AAA-0001', phase: 'return', photos: [] })
      .expect(403);
  });

  await t.test('submission rejects requests that bypass server-side photo validation', async () => {
    const response = await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-BYPASS', plate: 'AAA-0001', phase: 'return', photos: [] })
      .expect(422);
    assert.equal(response.body.error.code, 'IMAGE_QUALITY_CHECK_FAILED');
  });

  await t.test('the four exterior slots are sufficient for a completed submission', async () => {
    const photos = await uploadValidatedPhotos(userAAgent, userACsrf, {
      rentalId: 'R-EXTERIOR-ONLY', plate: 'AAA-0001', phase: 'pickup'
    });
    assert.deepEqual(photos.map(photo => photo.slot), REQUIRED_PHOTO_SLOTS);
    await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-EXTERIOR-ONLY', plate: 'AAA-0001', phase: 'pickup', photos })
      .expect(200);
  });

  await t.test('non-image upload payload is rejected', async () => {
    await userAAgent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-FILE', plate: 'AAA-0001', slot: 'front', filename: 'attack.html', imageData: 'data:text/html;base64,PHNjcmlwdD4=' })
      .expect(415);
  });

  await t.test('mismatched magic bytes and undecodable images are rejected', async () => {
    await userAAgent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-MAGIC', plate: 'AAA-0001', slot: 'front', filename: 'fake.png', imageData: 'data:image/png;base64,/9j/4AAQSkZJRg==' })
      .expect(400);
    await userAAgent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-DECODE', plate: 'AAA-0001', slot: 'front', filename: 'broken.png', imageData: 'data:image/png;base64,iVBORw0KGgo=' })
      .expect(400);
  });

  await t.test('backend rejects a decodable but clearly blurry upload with IMAGE_TOO_BLURRY', async () => {
    const response = await userAAgent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', userACsrf)
      .send({
        rentalId: 'R-BLUR', plate: 'AAA-0001', phase: 'return', slot: 'front', filename: 'flat.png',
        imageData: await blurredImageData(),
        // A caller may claim that its client pre-check passed. The server must ignore it.
        frontendSharpness: 999,
        isBlur: false
      })
      .expect(422);
    assert.equal(response.body.error.code, 'IMAGE_TOO_BLURRY');
    assert.equal(response.body.quality.blur.passed, false);
    assert.ok(response.body.photoId);

    const clearPhotos = await uploadValidatedPhotos(userAAgent, userACsrf, {
      rentalId: 'R-BLUR', plate: 'AAA-0001', phase: 'return'
    });
    const submissionPhotos = clearPhotos.map(photo => photo.slot === 'front'
      ? { ...photo, photoId: response.body.photoId, filename: 'flat.png' }
      : photo);
    const submission = await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-BLUR', plate: 'AAA-0001', phase: 'return', photos: submissionPhotos })
      .expect(422);
    assert.equal(submission.body.error.code, 'IMAGE_QUALITY_CHECK_FAILED');
  });

  let submissionId;
  await t.test('resource owner can read submission while another user receives 404', async () => {
    const photos = await uploadValidatedPhotos(userAAgent, userACsrf, {
      rentalId: 'R-OWNER-A', plate: 'AAA-0001', phase: 'return', station: '台北站'
    });
    const created = await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', userACsrf)
      .send({
        rentalId: 'R-OWNER-A', plate: 'AAA-0001', phase: 'return', station: '台北站',
        returnLocation: { address: '台北市信義區信義路五段 7 號', parkingSlot: '路邊停車', station: '台北站' },
        photos
      })
      .expect(200);
    submissionId = created.body.submissionId;
    const incidentId = created.body.createdIncidents[0];
    const ownPhoto = created.body.changedResource.data.photos.find(photo => photo.submissionId === submissionId);
    assert.match(submissionId, /^SUB-[A-Za-z0-9_-]{16}$/);
    assert.match(ownPhoto.photoId, /^PHOTO-[A-Za-z0-9_-]{16}$/);
    await userAAgent.get(`/api/submissions/${submissionId}`).expect(200);
    await userAAgent.get(`/${ownPhoto.filePath}`).expect(200);

    const userBAgent = request.agent(app);
    await login(userBAgent, 'user-b', password);
    await userBAgent.get(`/api/submissions/${submissionId}`).expect(404);
    await userBAgent.get(`/${ownPhoto.filePath}`).expect(404);
    const userBState = await userBAgent.get('/api/state').expect(200);
    assert.equal(userBState.body.incidents.some(incident => incident.id === incidentId), false);
  });

  await t.test('admin can call an admin API', async () => {
    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    await agent.post('/api/settings/line')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ enabled: false })
      .expect(200);
  });

  await t.test('agent operations and history are admin-only and drafts do not mutate incidents', async () => {
    await userAAgent.get('/api/agent/operations').expect(403);
    await userAAgent.get('/api/agent/history').expect(403);

    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    const beforeRepo = new DatabaseRepository(dbPath);
    const before = beforeRepo.getIncidents().map(item => ({ id: item.id, status: item.status, assignee: item.assignee }));
    beforeRepo.close();

    const operations = await agent.get('/api/agent/operations').expect(200);
    assert.equal(operations.body.ok, true);
    assert.ok(operations.body.operations.shiftBriefing);
    assert.ok(Array.isArray(operations.body.operations.slaAlerts));
    assert.ok(Array.isArray(operations.body.operations.dispatchDraft));
    assert.ok(Array.isArray(operations.body.operations.clusters));

    const afterRepo = new DatabaseRepository(dbPath);
    const after = afterRepo.getIncidents().map(item => ({ id: item.id, status: item.status, assignee: item.assignee }));
    afterRepo.close();
    assert.deepEqual(after, before);

    await agent.post('/api/agent/query')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ prompt: '產生交班摘要 token=must-not-be-stored' })
      .expect(400);
    const history = await agent.get('/api/agent/history?limit=6').expect(200);
    assert.ok(history.body.history.length >= 1);
    const serialized = JSON.stringify(history.body.history);
    assert.equal(serialized.includes('must-not-be-stored'), false);
    assert.match(serialized, /\[REDACTED\]/);
    assert.equal(/password_hash|sessionToken|csrfToken|apiKey/.test(serialized), false);
  });

  await t.test('dispatch and LINE drafts require admin confirmation and revalidate current state', async () => {
    const candidateRepo = new DatabaseRepository(dbPath);
    const candidates = candidateRepo.getIncidents();
    const eligibleIds = candidates.filter(item => ['pending_assignment', 'in_progress', 'assigned'].includes(item.status)).map(item => item.id);
    const anyIncidentId = candidates[0].id;
    candidateRepo.close();
    assert.ok(eligibleIds.length >= 2, JSON.stringify(candidates.map(item => [item.id, item.status])));
    const dispatchIncidentId = eligibleIds[0];
    const staleIncidentId = eligibleIds[1];

    await userAAgent.post('/api/agent/dispatch-drafts')
      .set('X-CSRF-Token', userACsrf)
      .send({ incidentId: dispatchIncidentId })
      .expect(403);

    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    await agent.post('/api/agent/dispatch-drafts')
      .set('X-CSRF-Token', 'forged-token')
      .send({ incidentId: dispatchIncidentId })
      .expect(403);

    const dispatchDraft = await agent.post('/api/agent/dispatch-drafts')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ incidentId: dispatchIncidentId, recommendedTeam: 'FORGED TEAM' });
    assert.equal(dispatchDraft.status, 200, JSON.stringify(dispatchDraft.body));
    assert.match(dispatchDraft.body.draft.id, /^DRAFT-[A-Za-z0-9_-]{16}$/);
    assert.notEqual(dispatchDraft.body.draft.preview.recommendedTeam, 'FORGED TEAM');

    const confirmed = await agent.post(`/api/agent/action-drafts/${dispatchDraft.body.draft.id}/confirm`)
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ recommendedTeam: 'FORGED TEAM' })
      .expect(200);
    assert.equal(confirmed.body.changedResource.data.status, 'assigned');
    assert.notEqual(confirmed.body.changedResource.data.assignedTeam, 'FORGED TEAM');
    await agent.post(`/api/agent/action-drafts/${dispatchDraft.body.draft.id}/confirm`)
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({})
      .expect(409);

    const staleDraft = await agent.post('/api/agent/dispatch-drafts')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ incidentId: staleIncidentId })
      .expect(200);
    const stateRepo = new DatabaseRepository(dbPath);
    stateRepo.updateIncidentStatusAndAssignee(staleIncidentId, 'in_progress', '現場小隊');
    stateRepo.close();
    await agent.post(`/api/agent/action-drafts/${staleDraft.body.draft.id}/confirm`)
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({})
      .expect(409);

    const lineDraft = await agent.post('/api/agent/line-drafts')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ incidentId: anyIncidentId, style: 'urgent', message: 'FORGED MESSAGE' })
      .expect(200);
    assert.match(lineDraft.body.draft.preview.message, new RegExp(anyIncidentId));
    assert.equal(lineDraft.body.draft.preview.message.includes('FORGED MESSAGE'), false);
    const lineConfirmed = await agent.post(`/api/agent/action-drafts/${lineDraft.body.draft.id}/confirm`)
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({})
      .expect(200);
    assert.equal(lineConfirmed.body.minimalSummary.action, 'line');
  });

  await t.test('SOP and Audit assistants use bounded admin-only retrieval with cited evidence', async () => {
    await userAAgent.post('/api/agent/sop-query').set('X-CSRF-Token', userACsrf)
      .send({ prompt: '維修完工照片不足怎麼辦？' }).expect(403);
    await userAAgent.post('/api/agent/audit-query').set('X-CSRF-Token', userACsrf)
      .send({ prompt: '列出權限遭拒紀錄' }).expect(403);

    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    const sop = await agent.post('/api/agent/sop-query').set('X-CSRF-Token', response.body.csrfToken)
      .send({ prompt: '維修完工照片不足怎麼辦？' }).expect(200);
    assert.equal(sop.body.model, 'bounded-sop-retrieval');
    assert.ok(sop.body.sources.some(source => source.chapter === '4.4 Maintenance Completion'));
    assert.match(sop.body.answer.evidence, /iRent Ops SOP/);

    const audit = await agent.post('/api/agent/audit-query').set('X-CSRF-Token', response.body.csrfToken)
      .send({ prompt: '列出被降權後仍嘗試操作 admin API 的帳號；DROP TABLE User;' }).expect(200);
    assert.equal(audit.body.model, 'allowlisted-audit-query');
    assert.equal(audit.body.query.action, 'AUTHZ_DENIED');
    assert.ok(audit.body.records.some(record => record.username === 'user-a' && record.action === 'AUTHZ_DENIED'));
    await agent.get('/api/auth/me').expect(200);
  });

  await t.test('Gemini operations query uses server-side API key and structured JSON output', async () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.GEMINI_API_KEY;
    let requestBody;
    let requestUrl;
    let requestHeaders;
    process.env.GEMINI_API_KEY = 'test-only-key';
    global.fetch = async (url, options) => {
      requestUrl = String(url);
      requestHeaders = options.headers;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({ title: '摘要', insight: '洞察', recommendation: '建議', evidence: '證據' }) })
      };
    };
    try {
      const agent = request.agent(app);
      const response = await login(agent, 'admin01', password);
      await agent.post('/api/agent/query').set('X-CSRF-Token', response.body.csrfToken)
        .send({ prompt: '產生今日摘要' }).expect(200);
      assert.match(requestUrl, /generativelanguage\.googleapis\.com\/v1beta\/interactions$/);
      assert.equal(requestHeaders['x-goog-api-key'], 'test-only-key');
      assert.equal(requestBody.model, 'gemini-3.8-flash');
      assert.equal(requestBody.response_format.mime_type, 'application/json');
      assert.deepEqual(requestBody.response_format.schema.required, ['title', 'insight', 'recommendation', 'evidence']);
      assert.equal(JSON.stringify(requestBody).includes('test-only-key'), false);
    } finally {
      global.fetch = originalFetch;
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  await t.test('vision comparison uses database photo IDs and keeps completion review under human control', async () => {
    await userAAgent.post('/api/agent/photo-compare').set('X-CSRF-Token', userACsrf)
      .send({ beforePhotoId: 'PHOTO-A', afterPhotoId: 'PHOTO-B' }).expect(403);

    const photoRepo = new DatabaseRepository(dbPath);
    const sourcePhoto = photoRepo.getUploadedPhotos().find(photo => Boolean(photo.file_path));
    assert.ok(sourcePhoto);
    photoRepo.insertUploadedPhoto({
      photo_id: 'PHOTO-COMPARE-AFTER', submission_id: sourcePhoto.submission_id, rental_id: sourcePhoto.rental_id,
      plate: sourcePhoto.plate, phase: 'return', slot: sourcePhoto.slot, filename: sourcePhoto.filename,
      file_path: sourcePhoto.file_path, quality_passed: 1, is_blur: 0, plate_visible: 1,
      angle_valid: 1, distance_valid: 1, ai_result_json: '{}', user_id: sourcePhoto.user_id
    });
    const reviewIncident = photoRepo.getIncidents().find(item => item.status === 'assigned');
    assert.ok(reviewIncident);
    photoRepo.close();

    const originalFetch = global.fetch;
    const originalKey = process.env.GEMINI_API_KEY;
    const capturedBodies = [];
    process.env.GEMINI_API_KEY = 'test-only-key';
    global.fetch = async (_url, options) => {
      capturedBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: JSON.stringify({
          comparisonType: 'no_material_change', decision: 'pass', confidence: 96,
          summary: '同一位置未見明顯殘留損傷。', suspectedRegions: [], evidence: ['同角度區域外觀一致']
        }) })
      };
    };
    try {
      const agent = request.agent(app);
      const response = await login(agent, 'admin01', password);
      await agent.post('/api/agent/photo-compare').set('X-CSRF-Token', response.body.csrfToken)
        .send({ beforePhotoId: '../../.env', afterPhotoId: 'PHOTO-COMPARE-AFTER' }).expect(404);
      const comparison = await agent.post('/api/agent/photo-compare').set('X-CSRF-Token', response.body.csrfToken)
        .send({ beforePhotoId: sourcePhoto.photo_id, afterPhotoId: 'PHOTO-COMPARE-AFTER', filePath: '../../.env' }).expect(200);
      assert.equal(comparison.body.review.decision, 'pass');
      const comparisonContent = capturedBodies[0].input;
      assert.equal(comparisonContent.filter(item => item.type === 'image' && item.data).length, 2);
      assert.equal(capturedBodies[0].response_format.mime_type, 'application/json');
      assert.deepEqual(capturedBodies[0].response_format.schema.required, ['comparisonType', 'decision', 'confidence', 'summary', 'suspectedRegions', 'evidence']);

      await agent.post('/api/action').set('X-CSRF-Token', response.body.csrfToken)
        .send({ action: 'in_progress', incidentId: reviewIncident.id }).expect(200);
      const maintenance = await agent.post('/api/action').set('X-CSRF-Token', response.body.csrfToken)
        .send({ action: 'maintenance_report', incidentId: reviewIncident.id, note: '已完成修復', photo: { name: 'complete.png', data: VALID_PNG } })
        .expect(200);
      assert.equal(maintenance.body.changedResource.data.status, 'in_progress');
      assert.equal(maintenance.body.changedResource.data.manualReviewRequired, true);
      assert.equal(maintenance.body.changedResource.data.autoClosed, false);
      assert.equal(maintenance.body.changedResource.data.aiReviewResult, 'pass');
    } finally {
      global.fetch = originalFetch;
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  await t.test('JSON API responses use backend compression when accepted', async () => {
    const agent = request.agent(app);
    await login(agent, 'admin01', password);
    const response = await agent.get('/api/state').set('Accept-Encoding', 'gzip').expect(200);
    assert.equal(response.headers['content-encoding'], 'gzip');
  });

  await t.test('stale LINE sending rows recover to queued during startup', async () => {
    const recoveryDb = new Database(dbPath);
    recoveryDb.prepare(`
      INSERT INTO NotificationLog(provider, incident_id, event_type, target_id, message, status, attempts, error, created_at, updated_at)
      VALUES ('line', NULL, 'test', NULL, 'restart recovery', 'sending', 1, NULL, ?, ?)
    `).run('2000-01-01 00:00:00', '2000-01-01 00:00:00');
    const id = recoveryDb.prepare('SELECT last_insert_rowid() AS id').get().id;
    recoveryDb.close();
    const recoveryRepo = new DatabaseRepository(dbPath);
    new NotificationService(recoveryRepo);
    const checkDb = new Database(dbPath, { readonly: true });
    const row = checkDb.prepare('SELECT status, error FROM NotificationLog WHERE id = ?').get(id);
    checkDb.close();
    recoveryRepo.close();
    assert.equal(row.status, 'queued');
    assert.equal(row.error, 'Recovered after process restart');
  });

  await t.test('raw session token is never stored in AuthSession', async () => {
    const sessionCookie = cookieValue(userALogin, 'irent_session');
    assert.ok(sessionCookie);
    const rawToken = decodeURIComponent(sessionCookie.slice(sessionCookie.indexOf('=') + 1));
    assert.ok(Buffer.from(rawToken, 'base64url').length >= 32);
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT token_hash FROM AuthSession WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1').get(userA.id);
    db.close();
    assert.ok(row.token_hash);
    assert.notEqual(row.token_hash, rawToken);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
    const sessionRow = new Database(dbPath, { readonly: true });
    const csrfRow = sessionRow.prepare('SELECT csrf_token_hash FROM AuthSession WHERE token_hash = ?').get(row.token_hash);
    sessionRow.close();
    assert.notEqual(csrfRow.csrf_token_hash, userACsrf);
    assert.match(csrfRow.csrf_token_hash, /^[a-f0-9]{64}$/);
  });

  await t.test('logout revokes the server session and old cookie cannot be reused', async () => {
    const oldCookie = cookieValue(userALogin, 'irent_session');
    await userAAgent.post('/api/auth/logout').set('X-CSRF-Token', userACsrf).send({}).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
  });

  await t.test('disabled account cannot log in', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ username: disabled.username, password })
      .expect(401);
    assert.equal(response.body.error, '使用者名稱或密碼錯誤');
  });

  await t.test('wrong username cannot log in and uses the generic message', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ username: 'missing-user', password })
      .expect(401);
    assert.equal(response.body.error, '使用者名稱或密碼錯誤');
  });

  await t.test('wrong password cannot log in and uses the generic message', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ username: 'user-a', password: 'definitely-wrong-password' })
      .expect(401);
    assert.equal(response.body.error, '使用者名稱或密碼錯誤');
  });

  await t.test('duplicate username is rejected case-insensitively', async () => {
    const repo = new DatabaseRepository(dbPath);
    const auth = new AuthService(repo);
    await assert.rejects(auth.createUser('USER-A', password, 'user'), /Username already exists/);
    repo.close();
  });

  await t.test('downgraded or disabled admin immediately loses existing-session access', async () => {
    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    const adminCsrf = response.body.csrfToken;
    const repo = new DatabaseRepository(dbPath);
    repo.setUserRole(admin.id, 'user');
    await agent.post('/api/settings/line').set('X-CSRF-Token', adminCsrf).send({ enabled: false }).expect(403);
    repo.setUserRole(admin.id, 'admin');
    repo.setUserActive(admin.id, false);
    repo.close();
    await agent.get('/api/auth/me').expect(401);
  });

  await t.test('server-side admin session revocation takes effect immediately', async () => {
    const repo = new DatabaseRepository(dbPath);
    repo.setUserActive(admin.id, true);
    const agent = request.agent(app);
    const response = await login(agent, 'admin01', password);
    repo.revokeAllAuthSessions(admin.id);
    repo.close();
    await agent.post('/api/settings/line').set('X-CSRF-Token', response.body.csrfToken).send({ enabled: false }).expect(401);
  });

  await t.test('successful re-login rotates and revokes the previous session', async () => {
    const agent = request.agent(app);
    const first = await login(agent, 'user-b', password);
    const oldCookie = cookieValue(first, 'irent_session');
    const nextCsrf = await csrf(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', nextCsrf).send({ username: 'USER-B', password }).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
  });

  await t.test('login rate limiting blocks repeated failures', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    for (let index = 0; index < 5; index += 1) {
      await agent.post('/api/auth/login').set('X-CSRF-Token', token)
        .send({ username: 'rate-limit-user', password: 'wrong-password-value' }).expect(401);
    }
    await agent.post('/api/auth/login').set('X-CSRF-Token', token)
      .send({ username: 'rate-limit-user', password: 'wrong-password-value' }).expect(429);
  });

  await t.test('audit logs redact forbidden metadata and record login/logout/admin events', () => {
    const repo = new DatabaseRepository(dbPath);
    repo.addAuditLog(admin.id, 'TEST_REDACTION', 'test', '1', {
      password: 'never-store-this', nested: { csrfToken: 'never-store-this-either' }, harmless: 'kept'
    });
    const logs = repo.getAuditLogs();
    repo.close();
    assert.ok(logs.some(log => log.action === 'LOGIN'));
    assert.ok(logs.some(log => log.action === 'LOGOUT'));
    assert.ok(logs.some(log => log.action === 'LINE_CONFIG_CHANGE'));
    const redacted = logs.find(log => log.action === 'TEST_REDACTION').metadata;
    assert.equal(redacted.includes('never-store-this'), false);
    assert.equal(redacted.includes('[REDACTED]'), true);
  });

  await t.test('production session cookie is HttpOnly, Secure, and SameSite=Lax', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const cookieApp = express();
    cookieApp.get('/', (_req, res) => {
      setAuthCookies(res, 'session-value', 'csrf-value', 60);
      res.sendStatus(204);
    });
    const response = await request(cookieApp).get('/').expect(204);
    process.env.NODE_ENV = previous;
    const sessionHeader = response.headers['set-cookie'].find(value => value.startsWith('irent_session='));
    assert.match(sessionHeader, /HttpOnly/);
    assert.match(sessionHeader, /Secure/);
    assert.match(sessionHeader, /SameSite=Lax/);
  });

  // Keep cleanup after all assertions; the app's repository owns the final open connection.
  assert.equal(userB.role, 'user');
  app.locals.databaseRepository.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
