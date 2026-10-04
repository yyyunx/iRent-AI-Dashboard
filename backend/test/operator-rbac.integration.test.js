const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createApp } = require('../src/app');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { AuthService } = require('../src/auth/AuthService');

test('two-role migration preserves accounts, custom columns, indexes and foreign references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-role-migrate-'));
  const dbPath = path.join(root, 'old.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE User(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'admin')), is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT, custom_note TEXT);
    CREATE INDEX custom_username ON User(username);
    CREATE TABLE AccountReference(user_id INTEGER REFERENCES User(id));
    INSERT INTO User VALUES(7, 'preserved-admin', 'original-hash', 'admin', 1, '2026-01-01', '2026-01-01', NULL, 'keep me');
    INSERT INTO AccountReference VALUES(7);`);
  db.close();
  const repo = new DatabaseRepository(dbPath);
  repo.setUserRole(7, 'operator');
  const check = new Database(dbPath, { readonly: true });
  assert.equal(check.prepare('SELECT custom_note FROM User WHERE id=7').get().custom_note, 'keep me');
  assert.equal(repo.getUserById(7).password_hash, 'original-hash');
  assert.equal(check.prepare('SELECT user_id FROM AccountReference').get().user_id, 7);
  assert.ok(check.prepare('PRAGMA index_list(User)').all().some(row => row.name === 'custom_username'));
  assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
  check.close(); repo.close();
});

test('operator cannot forge assignment or modify someone else’s incident', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-rbac-'));
  const app = createApp(path.join(root, 'test.db'), path.join(root, 'uploads'));
  const repo = app.locals.databaseRepository;
  repo.setSetting('lineNotificationEnabled', 'false');
  const auth = new AuthService(repo);
  const password = 'Operator-Test-Only-42!';
  await auth.createUser('admin-test', password, 'admin');
  await auth.createUser('staff-one', password, 'operator');
  await auth.createUser('staff-two', password, 'operator');
  const first = repo.getUserByUsername('staff-one'); const second = repo.getUserByUsername('staff-two');
  async function login(username) {
    const agent = request.agent(app); const csrf = await agent.get('/api/auth/csrf');
    const result = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ username, password }).expect(200);
    return { agent, csrf: result.body.csrfToken };
  }
  const a = await login('staff-one'); const b = await login('staff-two'); const admin = await login('admin-test');
  const act = (session, body) => session.agent.post('/api/action').set('X-CSRF-Token', session.csrf).send(body);
  try {
    const state = await a.agent.get('/api/state').expect(200);
    assert.ok(state.body.incidents.length > 0);
    await a.agent.get('/api/operators').expect(403);
    await a.agent.post('/api/settings/line').set('X-CSRF-Token', a.csrf).send({ enabled: true }).expect(403);
    await act(a, { action: 'dispatch', incidentId: 'INC-302', assigneeUserId: second.id }).expect(403);
    await act(a, { action: 'dispatch', incidentId: 'nonexistent', user_id: second.id }).expect(403);
    await act(a, { action: 'assign_self', incidentId: 'INC-302', assigneeUserId: second.id }).expect(403);
    await act(a, { action: 'assign_self', incidentId: 'INC-302' }).expect(200);
    assert.equal(repo.getIncidentById('INC-302').assigned_user_id, first.id);
    await act(b, { action: 'in_progress', incidentId: 'INC-302' }).expect(403);
    await act(b, { action: 'resolve', incidentId: 'INC-302' }).expect(403);
    await act(a, { action: 'in_progress', incidentId: 'INC-302' }).expect(200);
    await act(admin, { action: 'dispatch', incidentId: 'INC-302', assigneeUserId: second.id }).expect(409);
    await act(a, { action: 'resolve', incidentId: 'INC-302' }).expect(200);
    await act(a, { action: 'in_progress', incidentId: 'INC-302' }).expect(409);
    await act(a, { action: 'reopen', incidentId: 'INC-302' }).expect(403);
    await act(admin, { action: 'dispatch', incidentId: 'INC-303', assigneeUserId: second.id }).expect(200);
    assert.equal(repo.getIncidentById('INC-303').assigned_user_id, second.id);
  } finally { app.locals.stopWorkers(); repo.close(); }
});
