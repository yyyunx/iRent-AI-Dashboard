const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { NotificationService } = require('../src/services/NotificationService');
const { StageMetrics } = require('../src/services/StageMetrics');

test('LINE retry keeps its key/payload, accepts acknowledged 409 and measures latency', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-delivery-'));
  const repo = new DatabaseRepository(path.join(root, 'test.db'));
  const savedEnv = { LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN, LINE_TARGET_ID: process.env.LINE_TARGET_ID, PUBLIC_DASHBOARD_URL: process.env.PUBLIC_DASHBOARD_URL };
  Object.assign(process.env, { LINE_CHANNEL_ACCESS_TOKEN: 'fake-token', LINE_TARGET_ID: 'Ctest-only-group', PUBLIC_DASHBOARD_URL: 'https://dashboard.example' });
  const originalFetch = global.fetch; const calls = [];
  const notifications = new NotificationService(repo);
  global.fetch = async (_url, options) => {
    calls.push(options);
    return { ok: false, status: calls.length === 1 ? 500 : 409, headers: { get: name => calls.length > 1 && name === 'x-line-accepted-request-id' ? 'accepted-id' : null }, text: async () => '{}' };
  };
  const wait = async () => {
    for (let index = 0; index < 200; index++) {
      if (repo.getNotifications().every(row => !['queued', 'sending'].includes(row.status))) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Notification did not settle');
  };
  try {
    notifications.queueLineMessage('INC-302', 'dispatch', 'retry test');
    await wait();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['X-Line-Retry-Key'], calls[1].headers['X-Line-Retry-Key']);
    assert.equal(calls[0].body, calls[1].body);
    assert.equal(repo.getNotifications()[0].status, 'sent');
    assert.ok(new StageMetrics(repo).snapshot().stages.some(row => row.stage === 'line_api' && row.errors === 1));

    repo.insertIncident({ id: 'INC-urgent', plate: 'URG-123', station: '台北站', type: 'damage', label: '車損', severity: 'high', confidence: 91, status: 'pending_assignment' });
    repo.updateIncidentStatusAndAssignee('INC-urgent', 'pending_assignment', '待派工', { urgency_score: 9 });
    const db = new Database(path.join(root, 'test.db'));
    db.prepare("UPDATE Incident SET created_at = '2000-01-01 00:00:00' WHERE id = 'INC-urgent'").run(); db.close();
    global.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' });
    assert.equal(notifications.scanAssignmentEscalations(), 1);
    assert.equal(notifications.scanAssignmentEscalations(), 0);
    await wait();
    assert.equal(repo.getNotifications().filter(row => row.event_type === 'assignment_escalation').length, 1);
    assert.ok(repo.getTimelines()['INC-urgent'].some(row => row.event_type === 'assignment_escalation'));
  } finally {
    notifications.close(); repo.close(); global.fetch = originalFetch;
    for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
