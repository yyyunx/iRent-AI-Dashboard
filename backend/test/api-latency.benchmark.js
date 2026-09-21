// Local API processing benchmark. Uses a disposable SQLite database and no external services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { DatabaseRepository } = require('../src/repositories/DatabaseRepository');
const { AuthService } = require('../src/auth/AuthService');

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'irent-api-benchmark-'));
  const databasePath = path.join(temporaryDirectory, 'benchmark.db');
  let app;
  try {
    const setup = new DatabaseRepository(databasePath);
    await new AuthService(setup).createUser('benchmark-admin', 'Benchmark-Only-Password-42!', 'admin');
    setup.close();
    app = createApp(databasePath, path.join(temporaryDirectory, 'uploads'));
    const agent = request.agent(app);
    const csrf = await agent.get('/api/auth/csrf');
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ username: 'benchmark-admin', password: 'Benchmark-Only-Password-42!' });
    if (login.status !== 200) throw new Error(`Benchmark login failed: ${login.status}`);

    const routes = ['/api/state', '/api/incidents/map', '/api/submissions'];
    const responseBytes = {};
    for (let iteration = 0; iteration < 30; iteration += 1) {
      for (const route of routes) {
        const response = await agent.get(route);
        if (response.status !== 200) throw new Error(`${route} returned ${response.status}`);
        responseBytes[route] = Buffer.byteLength(JSON.stringify(response.body));
      }
    }
    const performance = await agent.get('/api/performance');
    const endpoints = performance.body.performance.endpoints.filter(item =>
      routes.some(route => item.path === route.slice(4)) || item.path === '/auth/login');
    process.stdout.write(`${JSON.stringify({ fixture: 'fresh SQLite with seeded incidents', iterations: 30, responseBytes, endpoints }, null, 2)}\n`);
  } finally {
    app?.locals.databaseRepository.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
