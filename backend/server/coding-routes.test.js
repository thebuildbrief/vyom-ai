import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { installAiRoutes } from './ai-coding-routes.js';

function fixture() {
  const raw = new Database(':memory:');
  const db = {
    dialect: 'sqlite',
    prepare(sql) { const statement = raw.prepare(sql), normalize = values => values.map(value => typeof value === 'boolean' ? Number(value) : value); return { get: (...values) => statement.get(...normalize(values)), all: (...values) => statement.all(...normalize(values)), run: (...values) => statement.run(...normalize(values)) }; },
    exec: raw.exec.bind(raw), pragma: raw.pragma.bind(raw), transaction: raw.transaction.bind(raw)
  };
  migrate(db);
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('candidate', 'Candidate', 'candidate@example.test', 'hash');
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('outsider', 'Outsider', 'outsider@example.test', 'hash');
  raw.prepare("INSERT INTO interviews(id,user_id,role,type,difficulty,status) VALUES('interview-1','candidate','Software Engineer','Technical','Medium','active')").run();
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method, (route, ...handlers) => routes.set(`${method.toUpperCase()} ${route}`, handlers)]));
  const auth = (req, _res, next) => { req.user = { id: 'candidate' }; return next(); };
  const owned = async (req, res, next) => {
    const item = await db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!item) return res.status(404).json({ error: 'Interview not found.' });
    req.interview = item;
    return next();
  };
  installAiRoutes(app, { db, auth, owned });
  return { raw, db, routes };
}

async function invoke(f, method, route, { params = { id: 'interview-1' }, body = {}, query = {} } = {}) {
  const handlers = f.routes.get(`${method} ${route}`);
  assert.ok(handlers, `registered ${method} ${route}`);
  const req = { params, body, query, user: { id: 'candidate' }, headers: {}, get: () => '' };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, setHeader() { return this; } };
  const run = async index => { const handler = handlers[index]; if (index === handlers.length - 1) return handler(req, res); return handler(req, res, () => run(index + 1)); };
  await run(0);
  return res;
}

test('coding problems, workspace, real submit judging and progress history are backed by the database', async t => {
  const f = fixture();
  const keys = { JDOODLE_CLIENT_ID: process.env.JDOODLE_CLIENT_ID, JDOODLE_CLIENT_SECRET: process.env.JDOODLE_CLIENT_SECRET, JDOODLE_API_URL: process.env.JDOODLE_API_URL };
  const oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(keys)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    f.raw.close();
  });
  process.env.JDOODLE_CLIENT_ID = 'test-client';
  process.env.JDOODLE_CLIENT_SECRET = 'test-secret';
  process.env.JDOODLE_API_URL = 'https://jdoodle.test/v1/execute';
  let executions = 0;
  globalThis.fetch = async () => {
    executions += 1;
    return new Response(JSON.stringify({ statusCode: 200, output: '0 1\n', cpuTime: '0.01', memory: 1024 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const problems = await invoke(f, 'GET', '/api/coding/problems');
  assert.equal(problems.statusCode, 200);
  assert.equal(problems.body.problems.length, 5);
  assert.equal(problems.body.problems[0].sample_tests.length, 3);
  assert.equal(problems.body.problems[0].test_count, 4);
  assert.ok(problems.body.problems[0].starters.Python.includes('def solve'));

  const emptyProgress = await invoke(f, 'GET', '/api/coding/progress');
  assert.equal(emptyProgress.body.stats.submissions, 0);
  assert.equal(emptyProgress.body.stats.total_problems, 5);
  assert.deepEqual(emptyProgress.body.history, []);

  const workspace = await invoke(f, 'POST', '/api/coding/workspace');
  assert.equal(workspace.statusCode, 201);
  assert.equal(workspace.body.interview.type, 'DSA');
  assert.equal(workspace.body.interview.topics, 'Coding practice workspace');
  const again = await invoke(f, 'POST', '/api/coding/workspace');
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.interview.id, workspace.body.interview.id);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM interviews WHERE user_id='candidate' AND type='DSA'").get().n, 1);

  const invalid = await invoke(f, 'POST', '/api/interviews/:id/code', { body: { language: 'Python', source: 'print(1)', mode: 'submit', problem_key: 'missing' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(executions, 0);

  const submitted = await invoke(f, 'POST', '/api/interviews/:id/code', { body: { language: 'Python', source: 'print("0 1")', mode: 'submit', problem_key: 'two-sum' } });
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.mode, 'submit');
  assert.equal(submitted.body.problem_key, 'two-sum');
  assert.equal(submitted.body.passed, 2);
  assert.equal(submitted.body.total, 4);
  assert.equal(submitted.body.test_results.length, 4);
  assert.equal(submitted.body.test_results[0].input, '2 7 11 15\n9');
  assert.equal(submitted.body.test_results[3].hidden, true);
  assert.equal(submitted.body.test_results[3].expected, null);
  assert.equal(submitted.body.test_results[3].input, null);
  assert.equal(executions, 4);
  const stored = f.raw.prepare('SELECT problem_key,mode,result FROM submissions WHERE id=?').get(submitted.body.submissionId);
  assert.equal(stored.problem_key, 'two-sum');
  assert.equal(stored.mode, 'submit');
  assert.equal(JSON.parse(stored.result).passed, 2);

  const run = await invoke(f, 'POST', '/api/interviews/:id/code', { body: { language: 'Python', source: 'print(input())', mode: 'run', problem_key: 'two-sum', input: 'hello' } });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.total, 1);
  assert.equal(run.body.test_results[0].passed, null);
  assert.equal(run.body.test_results[0].input, 'hello');
  const unverifiedRun = await invoke(f, 'POST', '/api/interviews/:id/code', { body: { language: 'Python', source: 'print("0 1")', mode: 'run', problem_key: 'two-sum', test_cases: [{ input: 'arbitrary', expected_output: '0 1' }] } });
  assert.equal(unverifiedRun.body.passed, 1);

  const progress = await invoke(f, 'GET', '/api/coding/progress');
  assert.equal(progress.body.stats.submissions, 3);
  assert.equal(progress.body.stats.solved, 0);
  assert.equal(progress.body.stats.passed_tests, 2);
  assert.equal(progress.body.stats.total_tests, 4);
  const submitHistory = progress.body.history.find(item => item.mode === 'submit');
  const runHistory = progress.body.history.find(item => item.mode === 'run');
  assert.equal(submitHistory.problem_title, 'Two Sum');
  assert.equal(runHistory.language, 'Python');
  assert.equal(runHistory.total, 0);
});

test('coding routes reject another user’s interview session', async t => {
  const f = fixture();
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; f.raw.close(); });
  const handlers = f.routes.get('POST /api/interviews/:id/code');
  const req = { params: { id: 'interview-1' }, body: { language: 'Python', source: 'print(1)' }, user: { id: 'outsider' }, headers: {}, get: () => '' };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  const owned = async (request, response, next) => {
    const item = await f.db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(request.params.id, request.user.id);
    if (!item) return response.status(404).json({ error: 'Interview not found.' });
    request.interview = item;
    return next();
  };
  await owned(req, res, () => handlers[handlers.length - 1](req, res));
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /not found/i);
});
