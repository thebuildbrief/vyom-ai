import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { migrate } from './migrate.js';
import { installAiRoutes } from './ai-coding-routes.js';

test('interview finish is claimed once, saves the evidence-based report, and releases the claim on failure', async t => {
  const raw = new Database(':memory:');
  const db = { dialect: 'sqlite', prepare: raw.prepare.bind(raw), exec: raw.exec.bind(raw), pragma: raw.pragma.bind(raw), transaction: raw.transaction.bind(raw) };
  migrate(db);
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('owner', 'Owner', 'owner@example.test', 'hash');
  raw.prepare("INSERT INTO interviews(id,user_id,role,type,difficulty,duration,interviewer,status) VALUES('i1','owner','Engineer','Behavioral','Easy',20,'Tanya','active'),('i2','owner','Engineer','Behavioral','Easy',20,'Tanya','active')").run();
  raw.prepare("INSERT INTO messages(id,interview_id,user_id,role,content,created_at) VALUES('m1','i1','owner','assistant','Tell me about a project.','2026-01-01T00:00:00.000Z'),('m2','i1','owner','user','I built a dashboard.','2026-01-01T00:00:01.000Z'),('m3','i2','owner','user','I improved latency.','2026-01-01T00:00:02.000Z')").run();
  const routes = new Map();
  const app = { get: (route, ...handlers) => routes.set(`GET ${route}`, handlers), post: (route, ...handlers) => routes.set(`POST ${route}`, handlers) };
  const secret = 'ai-test-secret-at-least-32-characters';
  const token = jwt.sign({ id: 'owner' }, secret);
  const auth = (req, res, next) => { try { req.user = jwt.verify(req.headers.authorization?.replace(/^Bearer /, '') || '', secret); return next(); } catch { res.status(401).json({ error: 'Sign in required' }); } };
  const owned = async (req, res, next) => { const item = await db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!item) return res.status(404).json({ error: 'Interview not found.' }); req.interview = item; return next(); };
  installAiRoutes(app, { db, auth, owned });

  const report = { overall_score: 78, categories: { technical_knowledge: 80, answer_relevance: 75 }, strengths: ['Clear reasoning'], improvements: ['Quantify impact'], summary: 'Solid session.', questions_answered: ['Tell me about a project.'], questions_missed: [], recommended_practice: ['Practice graphs'], next_difficulty: 'Medium', question_feedback: [{ question: 'Tell me about a project.', feedback: 'Give measurable outcomes.', suggested_answer: 'I cut load time by 40%.' }], suggested_answers: [{ question: 'Tell me about a project.', answer: 'I cut load time by 40%.' }], challenges: ['Implement topological sort'], study_minutes: 25 };
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-key';
  t.after(() => { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; raw.close(); });

  async function call(method, route, { params = {}, body = {}, headers = {} } = {}) {
    const handlers = routes.get(`${method} ${route}`);
    assert.ok(handlers, `Route ${method} ${route} was registered`);
    const req = { headers: { authorization: `Bearer ${token}`, ...headers }, params, body, get: name => req.headers[String(name).toLowerCase()] };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    const run = async index => { const handler = handlers[index]; if (index === handlers.length - 1) return handler(req, res); return handler(req, res, () => run(index + 1)); };
    await run(0);
    return res;
  }

  globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 60)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const [first, second] = await Promise.all([call('POST', '/api/interviews/:id/finish', { params: { id: 'i1' } }), call('POST', '/api/interviews/:id/finish', { params: { id: 'i1' } })]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const success = first.statusCode === 200 ? first : second;
  assert.equal(success.body.report.overall_score, 78);
  const stored = raw.prepare("SELECT r.overall_score, r.details, i.status FROM reports r JOIN interviews i ON i.id=r.interview_id WHERE r.interview_id='i1'").get();
  assert.equal(stored.overall_score, 78);
  assert.equal(stored.status, 'completed');
  assert.equal(JSON.parse(stored.details).study_minutes, 25);
  assert.equal(JSON.parse(stored.details).question_feedback[0].suggested_answer, 'I cut load time by 40%.');
  assert.equal((await call('POST', '/api/interviews/:id/finish', { params: { id: 'i1' } })).statusCode, 409);
  assert.equal((await call('POST', '/api/interviews/:id/transcript', { params: { id: 'i1' }, body: { role: 'user', content: 'late answer' } })).statusCode, 409);

  const added = await call('POST', '/api/interviews/:id/transcript', { params: { id: 'i2' }, body: { role: 'assistant', content: 'What did you measure?' }, headers: { 'idempotency-key': 'voice-turn-1' } });
  assert.equal(added.statusCode, 201);
  const duplicate = await call('POST', '/api/interviews/:id/transcript', { params: { id: 'i2' }, body: { role: 'assistant', content: 'What did you measure?' }, headers: { 'idempotency-key': 'voice-turn-1' } });
  assert.equal(duplicate.body.id, 'voice-turn-1');
  assert.equal(raw.prepare("SELECT count(*) AS n FROM messages WHERE interview_id='i2' AND id='voice-turn-1'").get().n, 1);

  globalThis.fetch = async () => new Response('provider unavailable', { status: 500 });
  const failed = await call('POST', '/api/interviews/:id/finish', { params: { id: 'i2' } });
  assert.equal(failed.statusCode, 502);
  const released = raw.prepare("SELECT status, finish_started_at FROM interviews WHERE id='i2'").get();
  assert.equal(released.status, 'active');
  assert.equal(released.finish_started_at, null);
});
