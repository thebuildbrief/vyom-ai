import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { migrate } from './migrate.js';
import { installCommunityRoutes, summarizeTimerSessions } from './community-routes.js';

test('friends and study room routes persist data and enforce membership ownership', async t => {
  const raw = new Database(':memory:');
  const db = { dialect: 'sqlite', prepare: raw.prepare.bind(raw), exec: raw.exec.bind(raw), pragma: raw.pragma.bind(raw), transaction: raw.transaction.bind(raw) };
  migrate(db);
  const insert = raw.prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES(?,?,?,?,1)');
  insert.run('alice', 'Alice', 'alice@example.test', 'hash');
  insert.run('bob', 'Bob', 'bob@example.test', 'hash');
  insert.run('eve', 'Eve', 'eve@example.test', 'hash');
  raw.prepare("INSERT INTO interviews(id,user_id,status) VALUES('alice-interview','alice','completed'),('bob-interview','bob','completed')").run();
  raw.prepare("INSERT INTO reports(id,interview_id,user_id,overall_score,details) VALUES('alice-report','alice-interview','alice',72,'{}'),('bob-report','bob-interview','bob',91,'{}')").run();
  const routes = new Map();
  const app = Object.fromEntries(['get','post','delete'].map(method => [method, (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers)]));
  const testSecret = 'community-test-secret-at-least-32-characters';
  const tokens = Object.fromEntries(['alice','bob','eve'].map(id => [id, jwt.sign({ id }, testSecret)]));
  const auth = (req, res, next) => {
    try { req.user = jwt.verify(req.headers.authorization?.replace(/^Bearer /, '') || '', testSecret); return next(); }
    catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
  };
  installCommunityRoutes(app, { db, auth });
  t.after(() => raw.close());
  const call = async (user, method, path, { body = {}, params = {}, query = {} } = {}) => {
    const handlers = routes.get(`${method} ${path}`);
    assert.ok(handlers, `Route ${method} ${path} was registered`);
    const req = { headers: { authorization: `Bearer ${tokens[user] || ''}` }, body, params, query };
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    const run = async index => { const handler = handlers[index]; if (index === handlers.length - 1) return handler(req, response); return handler(req, response, () => run(index + 1)); };
    await run(0);
    return { status: response.statusCode, body: response.body };
  };

  assert.equal((await call('unknown', 'GET', '/api/friends')).status, 401);
  const search = await call('alice', 'GET', '/api/friends/search', { query: { email: 'bob@example.test' } });
  assert.equal(search.body.user.id, 'bob');
  const request = await call('alice', 'POST', '/api/friends/requests', { body: { user_id: 'bob' } });
  assert.equal(request.status, 201);
  const incoming = await call('bob', 'GET', '/api/friends');
  assert.equal(incoming.body.requests[0].user_id, 'alice');
  assert.equal((await call('bob', 'POST', '/api/friends/requests/:id/accept', { params: { id: incoming.body.requests[0].id } })).status, 200);
  const leaderboard = (await call('alice', 'GET', '/api/friends/leaderboard')).body.leaderboard;
  assert.equal(leaderboard.length, 2);
  assert.equal(leaderboard[0].id, 'bob');
  assert.equal(leaderboard[0].average_score, 91);

  const created = await call('alice', 'POST', '/api/study-rooms', { body: { name: 'Algorithms' } });
  const roomId = created.body.room.id;
  const joined = await call('bob', 'POST', '/api/study-rooms/join', { body: { join_code: created.body.room.join_code } });
  assert.equal(joined.status, 200);
  assert.equal((await call('eve', 'GET', '/api/study-rooms/:id', { params: { id: roomId } })).status, 404);
  assert.equal((await call('bob', 'POST', '/api/study-rooms/:id/messages', { params: { id: roomId }, body: { content: 'Let’s solve this together.' } })).status, 201);
  const view = await call('alice', 'GET', '/api/study-rooms/:id', { params: { id: roomId } });
  assert.equal(view.body.messages[0].content, 'Let’s solve this together.');
  assert.equal(view.body.members.length, 2);
  assert.equal((await call('alice', 'POST', '/api/study-rooms/:id/timer/start', { params: { id: roomId } })).body.timer.active, true);
  await call('alice', 'POST', '/api/study-rooms/:id/timer/start', { params: { id: roomId } });
  assert.equal(raw.prepare('SELECT count(*) AS n FROM study_room_sessions WHERE room_id=? AND user_id=? AND ended_at IS NULL').get(roomId, 'alice').n, 1);
  assert.equal((await call('bob', 'POST', '/api/study-rooms/:id/timer/start', { params: { id: roomId } })).body.timer.active_members, 2);
  const activeView = await call('alice', 'GET', '/api/study-rooms/:id', { params: { id: roomId } });
  assert.equal(activeView.body.room_leaderboard.length, 2);
  assert.equal(activeView.body.room_progress.active_members, 2);
  assert.equal(activeView.body.room_progress.sessions, 2);
  assert.ok(activeView.body.room_leaderboard.every(row => row.active));
  await new Promise(resolve => setTimeout(resolve, 1100));
  await call('alice', 'POST', '/api/study-rooms/:id/timer/heartbeat', { params: { id: roomId } });
  await call('bob', 'POST', '/api/study-rooms/:id/timer/heartbeat', { params: { id: roomId } });
  const aliceTimer = await call('alice', 'POST', '/api/study-rooms/:id/timer/stop', { params: { id: roomId } });
  const bobTimer = await call('bob', 'POST', '/api/study-rooms/:id/timer/stop', { params: { id: roomId } });
  assert.ok(aliceTimer.body.timer.individual_seconds >= 1);
  assert.ok(bobTimer.body.timer.individual_seconds >= 1);
  assert.ok(bobTimer.body.timer.group_seconds >= aliceTimer.body.timer.individual_seconds);
  assert.ok(bobTimer.body.timer.group_seconds <= aliceTimer.body.timer.individual_seconds + bobTimer.body.timer.individual_seconds);
  const finishedView = await call('alice', 'GET', '/api/study-rooms/:id', { params: { id: roomId } });
  assert.equal(finishedView.body.room_progress.sessions, 2);
  assert.ok(finishedView.body.room_leaderboard.every(row => row.study_seconds >= 1));
  assert.equal(finishedView.body.room_progress.total_focused_seconds, finishedView.body.room_leaderboard.reduce((sum, row) => sum + row.study_seconds, 0));

  raw.prepare("INSERT INTO submissions(id,interview_id,user_id,language,result,problem_key,mode) VALUES('bob-submission','bob-interview','bob','Python',?,'two-sum','submit')").run(JSON.stringify({ passed: 3, total: 3 }));
  raw.prepare("INSERT INTO submissions(id,interview_id,user_id,language,result,problem_key,mode) VALUES('bob-unverified-run','bob-interview','bob','Python',?,'two-sum','run')").run(JSON.stringify({ passed: 99, total: 99 }));
  const allTime = await call('alice', 'GET', '/api/leaderboard', { query: { scope: 'friends', period: 'all' } });
  assert.equal(allTime.body.leaderboard.length, 2);
  const bobRow = allTime.body.leaderboard.find(row => row.id === 'bob');
  assert.equal(bobRow.coding_solved, 1);
  assert.equal(bobRow.coding_passed, 3);
  assert.ok(bobRow.study_seconds >= 1);
  assert.equal(bobRow.points_breakdown.coding, 30);
  assert.equal(allTime.body.leaderboard.reduce((top, row) => Math.max(top, row.points), 0), allTime.body.leaderboard[0].points);

  raw.prepare("INSERT INTO interviews(id,user_id,status) VALUES('eve-interview','eve','completed')").run();
  raw.prepare("INSERT INTO reports(id,interview_id,user_id,overall_score,created_at) VALUES('eve-old-report','eve-interview','eve',100,'2000-01-01T00:00:00.000Z')").run();
  const weeklyGlobal = await call('alice', 'GET', '/api/leaderboard', { query: { scope: 'global', period: 'weekly' } });
  assert.equal(weeklyGlobal.body.scope, 'global');
  assert.equal(weeklyGlobal.body.period, 'weekly');
  const eveWeekly = weeklyGlobal.body.leaderboard.find(row => row.id === 'eve');
  assert.equal(eveWeekly.completed_interviews, 0);
  assert.equal(eveWeekly.points, 0);
  const oldGlobal = await call('alice', 'GET', '/api/leaderboard', { query: { scope: 'global', period: 'all' } });
  assert.equal(oldGlobal.body.leaderboard.find(row => row.id === 'eve').completed_interviews, 1);

  insert.run('zoe', 'Zoe', 'zoe@example.test', 'hash');
  tokens.zoe = jwt.sign({ id: 'zoe' }, testSecret);
  const addUser = raw.prepare('INSERT INTO users(id,name,email,password,email_verified) VALUES(?,?,?,?,1)');
  for (let index = 0; index < 101; index += 1) {
    const name = `User ${String(index).padStart(3, '0')}`;
    addUser.run(`ranking-${index}`, name, `ranking-${index}@example.test`, 'hash');
  }
  const longGlobal = await call('zoe', 'GET', '/api/leaderboard', { query: { scope: 'global', period: 'all' } });
  assert.equal(longGlobal.body.leaderboard.length, 101);
  assert.equal(longGlobal.body.leaderboard.at(-1).id, 'zoe');
  assert.equal(longGlobal.body.leaderboard.at(-1).rank, 105);

  assert.equal((await call('bob', 'DELETE', '/api/study-rooms/:id', { params: { id: roomId } })).status, 404);
  assert.equal((await call('alice', 'DELETE', '/api/study-rooms/:id', { params: { id: roomId } })).status, 200);
});

test('group study time is the union of overlapping per-member intervals', () => {
  const base = Date.now();
  const totals = summarizeTimerSessions([
    { user_id: 'alice', started_at: new Date(base).toISOString(), ended_at: new Date(base + 10_000).toISOString(), last_heartbeat_at: new Date(base + 9_000).toISOString() },
    { user_id: 'bob', started_at: new Date(base + 5_000).toISOString(), ended_at: new Date(base + 15_000).toISOString(), last_heartbeat_at: new Date(base + 14_000).toISOString() }
  ], 'alice', base + 20_000);
  assert.equal(totals.individual_seconds, 10);
  assert.equal(totals.group_seconds, 15);
});
