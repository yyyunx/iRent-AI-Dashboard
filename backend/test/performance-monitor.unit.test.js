const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedPath } = require('../src/services/PerformanceMonitor');

test('performance monitor keeps named routes and redacts opaque IDs only', () => {
  assert.equal(normalizedPath('/photo-submissions'), '/photo-submissions');
  assert.equal(normalizedPath('/submissions/SUB-AbCdEfGhIjKlMnOp'), '/submissions/:id');
  assert.equal(normalizedPath('/incidents/INC-AI-AbCdEfGhIjKlMnOp'), '/incidents/:id');
});
