const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/auth/AuthService');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const express = require('express');
const { setAuthCookies } = require('../src/auth/cookies');
const { NotificationService } = require('../src/services/NotificationService');

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:5173';
const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOUlEQVR4nO3WywkAMBBCwaj995wqAjkM7F1Y/LyT7ukdAvWicVEEbaoi2rQGJyazqGLAq9BxX9P1BYyfGAFvvlyBAAAAAElFTkSuQmCC';

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

async function login(agent, email, password) {
  const initialCsrf = await csrf(agent);
  const response = await agent.post('/api/auth/login')
    .set('X-CSRF-Token', initialCsrf)
    .send({ email, password })
    .expect(200);
  assert.ok(response.body.csrfToken);
  assert.equal(response.body.user.email, email);
  return response;
}

test('authentication, RBAC, ownership, CSRF, and session revocation', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-auth-'));
  const dbPath = path.join(tempDir, 'test.db');
  const uploadDir = path.join(tempDir, 'uploads');
  const password = 'Correct-Horse-Battery-42!';

  const setupRepo = new DatabaseRepository(dbPath);
  const setupAuth = new AuthService(setupRepo);
  const admin = await setupAuth.createUser('admin@example.com', password, 'admin');
  const userA = await setupAuth.createUser('user-a@example.com', password, 'user');
  const userB = await setupAuth.createUser('user-b@example.com', password, 'user');
  const disabled = await setupAuth.createUser('disabled@example.com', password, 'user', false);
  setupRepo.close();

  const app = createApp(dbPath, uploadDir);

  await t.test('anonymous request to protected API returns 401', async () => {
    await request(app).get('/api/state').expect(401);
  });

  const userAAgent = request.agent(app);
  const userALogin = await login(userAAgent, 'user-a@example.com', password);
  let userACsrf = userALogin.body.csrfToken;

  await t.test('auth responses expose only safe user fields', async () => {
    assert.deepEqual(Object.keys(userALogin.body.user).sort(), ['email', 'id', 'role']);
    assert.equal('sessionToken' in userALogin.body, false);
    assert.equal('password_hash' in userALogin.body.user, false);
    const me = await userAAgent.get('/api/auth/me').expect(200);
    assert.deepEqual(Object.keys(me.body.user).sort(), ['email', 'id', 'role']);
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

  await t.test('non-image upload payload is rejected', async () => {
    await userAAgent.post('/api/photos/quality-check')
      .set('X-CSRF-Token', userACsrf)
      .send({ rentalId: 'R-FILE', plate: 'AAA-0001', slot: 'front', filename: 'attack.html', imageData: 'data:text/html;base64,PHNjcmlwdD4=' })
      .expect(400);
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

  let submissionId;
  await t.test('resource owner can read submission while another user receives 404', async () => {
    const created = await userAAgent.post('/api/photo-submissions')
      .set('X-CSRF-Token', userACsrf)
      .send({
        rentalId: 'R-OWNER-A', plate: 'AAA-0001', phase: 'return', station: '台北站',
        photos: [{ slot: 'right_side', filename: 'scratch.png', imageData: VALID_PNG }]
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
    await login(userBAgent, 'user-b@example.com', password);
    await userBAgent.get(`/api/submissions/${submissionId}`).expect(404);
    await userBAgent.get(`/${ownPhoto.filePath}`).expect(404);
    const userBState = await userBAgent.get('/api/state').expect(200);
    assert.equal(userBState.body.incidents.some(incident => incident.id === incidentId), false);
  });

  await t.test('admin can call an admin API', async () => {
    const agent = request.agent(app);
    const response = await login(agent, 'admin@example.com', password);
    await agent.post('/api/settings/line')
      .set('X-CSRF-Token', response.body.csrfToken)
      .send({ enabled: false })
      .expect(200);
  });

  await t.test('JSON API responses use backend compression when accepted', async () => {
    const agent = request.agent(app);
    await login(agent, 'admin@example.com', password);
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
      .send({ email: disabled.email, password })
      .expect(401);
    assert.equal(response.body.error, '帳號或密碼錯誤');
  });

  await t.test('invalid password cannot log in and uses the generic message', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent.post('/api/auth/login')
      .set('X-CSRF-Token', token)
      .send({ email: 'user-a@example.com', password: 'definitely-wrong-password' })
      .expect(401);
    assert.equal(response.body.error, '帳號或密碼錯誤');
  });

  await t.test('downgraded or disabled admin immediately loses existing-session access', async () => {
    const agent = request.agent(app);
    const response = await login(agent, 'admin@example.com', password);
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
    const response = await login(agent, 'admin@example.com', password);
    repo.revokeAllAuthSessions(admin.id);
    repo.close();
    await agent.post('/api/settings/line').set('X-CSRF-Token', response.body.csrfToken).send({ enabled: false }).expect(401);
  });

  await t.test('successful re-login rotates and revokes the previous session', async () => {
    const agent = request.agent(app);
    const first = await login(agent, 'user-b@example.com', password);
    const oldCookie = cookieValue(first, 'irent_session');
    const nextCsrf = await csrf(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', nextCsrf).send({ email: 'user-b@example.com', password }).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
  });

  await t.test('login rate limiting blocks repeated failures', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    for (let index = 0; index < 5; index += 1) {
      await agent.post('/api/auth/login').set('X-CSRF-Token', token)
        .send({ email: 'rate-limit@example.com', password: 'wrong-password-value' }).expect(401);
    }
    await agent.post('/api/auth/login').set('X-CSRF-Token', token)
      .send({ email: 'rate-limit@example.com', password: 'wrong-password-value' }).expect(429);
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
