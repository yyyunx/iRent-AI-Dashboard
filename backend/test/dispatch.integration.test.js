const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { AuthService } = require('../src/auth/AuthService');
const { incidentUrgency } = require('../src/services/IncidentUrgency');
const { NotificationService } = require('../src/services/NotificationService');

test('urgency counts damage detections and dirty findings and caps at ten', () => {
  assert.deepEqual(incidentUrgency([{ damageDetected: true }, { cleanliness: 'dirty' }]), { issueCount: 2, urgencyScore: 2, severity: 'low' });
  assert.equal(incidentUrgency([{ damageDetected: true, damage: { detections: Array(15).fill({}) } }]).urgencyScore, 10);
  assert.equal(incidentUrgency([{ damageDetected: false, damage: { detections: [{}] } }]).issueCount, 0);
});

test('authenticated dispatch, competing claims, LINE links and new submissions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-dispatch-'));
  const app = createApp(path.join(root, 'test.db'), path.join(root, 'uploads'));
  const repo = app.locals.databaseRepository;
  repo.setSetting('lineNotificationEnabled', 'false');
  const auth = new AuthService(repo);
  const password = 'Test-Dispatch-Only-42!';
  await auth.createUser('operator-a', password, 'admin');
  await auth.createUser('operator-b', password, 'admin');
  await auth.createUser('customer-a', password, 'user');
  const operatorA = repo.getUserByUsername('operator-a');
  const operatorB = repo.getUserByUsername('operator-b');
  const customer = repo.getUserByUsername('customer-a');
  async function login(name) {
    const agent = request.agent(app);
    const csrf = await agent.get('/api/auth/csrf');
    const response = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken).send({ username: name, password }).expect(200);
    return { agent, token: response.body.csrfToken };
  }
  const a = await login('operator-a'); const b = await login('operator-b'); const user = await login('customer-a');
  const action = (session, payload) => session.agent.post('/api/action').set('X-CSRF-Token', session.token).send(payload);
  try {
    const list = await a.agent.get('/api/operators').expect(200);
    assert.deepEqual(list.body.users.map(row => row.username), ['operator-a', 'operator-b']);
    assert.equal(JSON.stringify(list.body).includes('password'), false);
    await user.agent.get('/api/operators').expect(403);
    await request(app).get('/api/operators').expect(401);
    await a.agent.post('/api/action').send({ action: 'assign_self', incidentId: 'INC-302' }).expect(403);
    await user.agent.post('/api/action').set('X-CSRF-Token', user.token).send({ action: 'assign_self', incidentId: 'INC-302' }).expect(403);
    await action(a, { action: 'dispatch', incidentId: 'INC-302', assigneeUserId: customer.id }).expect(400);
    const claims = await Promise.all([
      action(a, { action: 'assign_self', incidentId: 'INC-302', assigneeUserId: operatorB.id }),
      action(b, { action: 'assign_self', incidentId: 'INC-302' })
    ]);
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409]);
    const winner = claims[0].status === 200 ? operatorA : operatorB;
    assert.equal(repo.getIncidentById('INC-302').assigned_user_id, winner.id);
    await action(a, { action: 'dispatch', incidentId: 'INC-302', assigneeUserId: operatorB.id }).expect(200);
    assert.equal(repo.getIncidentById('INC-302').assignee, 'operator-b');
    await action(a, { action: 'dispatch', incidentId: 'INC-302' }).expect(409);
    await action(b, { action: 'in_progress', incidentId: 'INC-302' }).expect(200);
    await action(a, { action: 'assign_self', incidentId: 'INC-302' }).expect(409);

    const { DashboardService } = require('../src/services/DashboardService');
    const service = new DashboardService(repo, path.join(root, 'uploads'));
    assert.deepEqual(service.createIncidentFromAiResult({ plate: 'TEST-123', phase: 'pickup' }, [], customer.id, 'SUB-clear'), []);
    const first = service.createIncidentFromAiResult({ plate: 'TEST-123', phase: 'pickup' }, [{ slot: 'front', damageDetected: true }, { slot: 'rear', cleanliness: 'dirty' }], customer.id, 'SUB-one');
    const second = service.createIncidentFromAiResult({ plate: 'TEST-123', phase: 'pickup' }, [{ slot: 'rear', damageDetected: true }], customer.id, 'SUB-two');
    assert.equal(first.length, 1); assert.equal(second.length, 1); assert.notEqual(first[0], second[0]);
    assert.equal(repo.getIncidentById(first[0]).issue_count, 2);

    const previousUrl = process.env.PUBLIC_DASHBOARD_URL;
    try {
      process.env.PUBLIC_DASHBOARD_URL = 'https://dashboard.example';
      const notifications = new NotificationService(repo);
      const messages = notifications.buildLineMessages({ incidentId: 'INC-302', message: 'test' });
      assert.equal(messages.length, 2);
      const actions = messages[1].template.actions;
      assert.equal(actions.length, 3);
      assert.equal(new URL(actions[1].uri).searchParams.get('intent'), 'assign_self');
      assert.equal(new URL(actions[2].uri).searchParams.get('incidentId'), 'INC-302');
      process.env.PUBLIC_DASHBOARD_URL = 'javascript:alert(1)';
      assert.equal(notifications.buildLineMessages({ incidentId: 'INC-302', message: 'test' }).length, 1);
      delete process.env.PUBLIC_DASHBOARD_URL;
      assert.equal(notifications.buildLineMessages({ incidentId: null, message: 'test' }).length, 1);
    } finally {
      if (previousUrl === undefined) delete process.env.PUBLIC_DASHBOARD_URL; else process.env.PUBLIC_DASHBOARD_URL = previousUrl;
    }
  } finally { repo.close(); }
});
