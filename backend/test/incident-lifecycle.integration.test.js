const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const request = require('supertest');
const { createApp } = require('../src/app');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { DashboardService } = require('../src/services/DashboardService');
const { AuthService } = require('../src/auth/AuthService');

test('versioned start/resolve races, stale assignment and actor transition history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-lifecycle-'));
  const app = createApp(path.join(root, 'test.db'), path.join(root, 'uploads'));
  const repo = app.locals.databaseRepository;
  repo.setSetting('lineNotificationEnabled', 'false');
  const password = 'Lifecycle-Test-Only-42!';
  await new AuthService(repo).createUser('lifecycle-admin', password, 'admin');
  const actor = repo.getUserByUsername('lifecycle-admin');
  const agent = request.agent(app);
  const csrf = await agent.get('/api/auth/csrf');
  const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ username: actor.username, password }).expect(200);
  const act = (action, expectedVersion, extra = {}) => agent.post('/api/action').set('X-CSRF-Token', login.body.csrfToken).send({ action, incidentId: 'INC-302', expectedVersion, ...extra });
  try {
    await act('assign_self', repo.getIncidentById('INC-302').version).expect(200);
    const assignedVersion = repo.getIncidentById('INC-302').version;
    const starts = await Promise.all([act('in_progress', assignedVersion), act('in_progress', assignedVersion)]);
    assert.deepEqual(starts.map(row => row.status).sort(), [200, 409]);
    await act('dispatch', assignedVersion, { assigneeUserId: actor.id }).expect(409);
    const processingVersion = repo.getIncidentById('INC-302').version;
    const closes = await Promise.all([act('resolve', processingVersion), act('resolve', processingVersion)]);
    assert.deepEqual(closes.map(row => row.status).sort(), [200, 409]);
    await act('in_progress', repo.getIncidentById('INC-302').version).expect(409);
    await act('reopen', repo.getIncidentById('INC-302').version).expect(200);
    assert.equal(repo.getIncidentById('INC-302').status, 'reopened');
    assert.equal(repo.getIncidentById('INC-302').assigned_user_id, null);
    await act('false_positive', repo.getIncidentById('INC-302').version).expect(200);
    assert.equal(repo.getIncidentById('INC-302').status, 'false_positive');
    const check = new Database(path.join(root, 'test.db'), { readonly: true });
    assert.ok(check.prepare('SELECT status FROM DispatchTask WHERE incident_id = ?').all('INC-302').every(task => task.status === 'false_positive'));
    check.close();
    const changes = repo.getTimelines()['INC-302'].filter(row => row.event_type === 'status_changed');
    assert.deepEqual(changes.map(row => row.new_status), ['assigned', 'in_progress', 'resolved', 'reopened', 'false_positive']);
    assert.ok(changes.every(row => row.actor_user_id === actor.id && row.old_status && !Number.isNaN(Date.parse(row.timestamp))));
  } finally { app.locals.stopWorkers(); repo.close(); }
});

test('submission retries are atomic, keyed requests conflict and unique source cannot replace an incident', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-idempotency-'));
  const dbPath = path.join(root, 'test.db');
  const repo = new DatabaseRepository(dbPath);
  const service = new DashboardService(repo, path.join(root, 'uploads'));
  repo.setSetting('lineNotificationEnabled', 'false');
  const slots = ['front', 'right_side', 'rear', 'left_side', 'front_interior', 'backseat_interior'];
  const photos = slots.map((slot, i) => {
    const photoId = `photo-retry-${i}`;
    repo.insertUploadedPhoto({ photo_id: photoId, rental_id: 'retry-rental', plate: 'RET-1234', phase: 'pickup', slot,
      filename: `${slot}.png`, quality_passed: 1, blur_score: 100, blur_threshold: 1, blur_checked_at: new Date().toISOString(), user_id: 101,
      ai_result_json: JSON.stringify({ damage: { schema_version: 'irent.damage.v1', photoId, damage_status: i === 0 ? 'detected' : 'none', detection_count: i === 0 ? 1 : 0, detections: i === 0 ? [{ label: 'Scratched', confidence: 0.9 }] : [], inference_status: 'success' } }) });
    return { slot, photoId };
  });
  const body = { rentalId: 'retry-rental', plate: 'RET-1234', phase: 'pickup', photos, idempotencyKey: 'stable-retry-key' };
  try {
    const [first, replay] = await Promise.all([service.handlePhotoSubmissionAction(body, 101), service.handlePhotoSubmissionAction(body, 101)]);
    assert.equal(first.submissionId, replay.submissionId);
    assert.deepEqual(first.createdIncidents, replay.createdIncidents);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(repo.getIncidents().filter(row => row.source_submission_id === first.submissionId).length, 1);
    await assert.rejects(service.handlePhotoSubmissionAction({ ...body, station: 'different-station' }, 101), error => error.status === 409);
    await assert.rejects(service.handlePhotoSubmissionAction(body, 202), error => error.status === 422);
    const incidentId = first.createdIncidents[0];
    assert.throws(() => repo.insertIncident({ ...repo.getIncidentById(incidentId), id: 'duplicate-source' }), /UNIQUE/);
    assert.ok(repo.getIncidentById(incidentId));
    assert.equal(repo.getIncidentById('duplicate-source'), null);
  } finally { repo.close(); }
});

test('legacy per-photo incidents merge with history, aliases and archived originals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-merge-'));
  const dbPath = path.join(root, 'test.db');
  let repo = new DatabaseRepository(dbPath);
  repo.close();
  const db = new Database(dbPath);
  db.exec('DROP INDEX idx_incident_submission_unique');
  db.prepare('UPDATE Incident SET source_submission_id = ? WHERE id IN (?, ?)').run('legacy-one-submission', 'INC-302', 'INC-303');
  db.exec("INSERT INTO Comment(incident_id, author, body, created_at) VALUES('INC-303', 'old', 'preserve comment', '2026-01-01')");
  db.close();
  repo = new DatabaseRepository(dbPath);
  const check = new Database(dbPath, { readonly: true });
  try {
    const canonical = repo.getIncidentById('INC-303');
    assert.ok(canonical);
    assert.equal(repo.getIncidents().filter(row => row.source_submission_id === 'legacy-one-submission').length, 1);
    assert.equal(repo.getIncidentById(repo.getIncidentAliases()['INC-303']).id, canonical.id);
    assert.equal(check.prepare('SELECT COUNT(*) AS count FROM IncidentMergeArchive').get().count, 2);
    assert.ok(repo.getComments()[canonical.id].some(row => row.body === 'preserve comment'));
    assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { check.close(); repo.close(); }
});
