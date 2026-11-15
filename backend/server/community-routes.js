import crypto from 'node:crypto';

const HEARTBEAT_GRACE_MS = 45_000;
const WEEK_MS = 7 * 864e5;
// SQLite CURRENT_TIMESTAMP is UTC without a zone; parse it as UTC, not local time.
const millis = value => {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`).getTime();
  return new Date(value).getTime();
};

export function timerIntervals(sessions, now) {
  return sessions.map(row => {
    const start = millis(row.started_at);
    let end = millis(row.ended_at);
    if (end == null) {
      const heartbeat = millis(row.last_heartbeat_at);
      end = heartbeat != null && now - heartbeat > HEARTBEAT_GRACE_MS ? heartbeat : now;
    }
    return { userId: row.user_id, start, end: Math.max(start || now, end || now), active: row.ended_at == null && now - (millis(row.last_heartbeat_at) || 0) <= HEARTBEAT_GRACE_MS };
  }).filter(row => Number.isFinite(row.start) && Number.isFinite(row.end));
}

export function studySecondsByUser(sessions, now, startMs = -Infinity, endMs = now) {
  const totals = new Map();
  for (const row of timerIntervals(sessions, now)) {
    const from = Math.max(row.start, startMs), to = Math.min(row.end, endMs);
    if (to > from) totals.set(row.userId, (totals.get(row.userId) || 0) + (to - from) / 1000);
  }
  return totals;
}

export function summarizeMemberStudy(sessions, now) {
  const totals = studySecondsByUser(sessions, now);
  const active = new Set(timerIntervals(sessions, now).filter(row => row.active).map(row => row.userId));
  return { totals, active };
}

function leaderboardPoints({ completed, averageScore, codingPassed, codingSolved, studySeconds }) {
  return completed * 50 + (averageScore ?? 0) + codingPassed * 5 + codingSolved * 15 + Math.floor(studySeconds / 60) * 2;
}

async function buildLeaderboard(db, userIds, { period, meId, now }) {
  const users = userIds
    ? await db.prepare(`SELECT id,name,profile_image FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).all(...userIds)
    : await db.prepare('SELECT id,name,profile_image FROM users ORDER BY created_at').all();
  if (!users.length) return [];
  const ids = users.map(user => user.id), marks = ids.map(() => '?').join(','), startMs = period === 'weekly' ? now - WEEK_MS : -Infinity;
  const [reports, submissions, sessions] = await Promise.all([
    db.prepare(`SELECT user_id,overall_score,created_at FROM reports WHERE user_id IN (${marks})`).all(...ids),
    db.prepare(`SELECT id,user_id,problem_key,result,created_at FROM submissions WHERE user_id IN (${marks})`).all(...ids),
    db.prepare(`SELECT user_id,started_at,ended_at,last_heartbeat_at FROM study_room_sessions WHERE user_id IN (${marks})`).all(...ids)
  ]);
  const activity = new Map(ids.map(id => [id, { completed: 0, scoreTotal: 0, codingPassed: 0, codingTotal: 0, solved: new Set(), studySeconds: 0 }]));
  for (const report of reports) {
    if ((millis(report.created_at) || 0) < startMs) continue;
    const row = activity.get(report.user_id);
    if (!row) continue;
    row.completed += 1;
    row.scoreTotal += Number(report.overall_score) || 0;
  }
  for (const submission of submissions) {
    if ((millis(submission.created_at) || 0) < startMs) continue;
    const row = activity.get(submission.user_id);
    if (!row) continue;
    let result = {};
    try { result = JSON.parse(submission.result || '{}'); } catch { /* Keep malformed historical rows from breaking the board. */ }
    const passed = Math.max(0, Number(result.passed) || 0), total = Math.max(0, Number(result.total) || 0);
    row.codingPassed += passed;
    row.codingTotal += total;
    if (total > 0 && passed === total && submission.problem_key) row.solved.add(submission.problem_key);
  }
  const studyTotals = studySecondsByUser(sessions, now, startMs, now);
  const rows = users.map(user => {
    const row = activity.get(user.id);
    row.studySeconds = Math.floor(studyTotals.get(user.id) || 0);
    const averageScore = row.completed ? Math.round(row.scoreTotal / row.completed) : null;
    const codingSolved = row.solved.size;
    const points = leaderboardPoints({ completed: row.completed, averageScore, codingPassed: row.codingPassed, codingSolved, studySeconds: row.studySeconds });
    return {
      id: user.id, name: user.name, profile_image: user.profile_image || null,
      points, completed_interviews: row.completed, average_score: averageScore,
      coding_passed: row.codingPassed, coding_total: row.codingTotal, coding_solved: codingSolved,
      study_seconds: row.studySeconds, me: user.id === meId,
      points_breakdown: { interviews: row.completed * 50, reports: averageScore ?? 0, coding: row.codingPassed * 5 + codingSolved * 15, study: Math.floor(row.studySeconds / 60) * 2 }
    };
  });
  rows.sort((a, b) => b.points - a.points || b.completed_interviews - a.completed_interviews || Number(b.average_score || 0) - Number(a.average_score || 0) || String(a.name).localeCompare(String(b.name)));
  return rows.slice(0, 100).map((row, index) => ({ ...row, rank: index + 1 }));
}

export function summarizeTimerSessions(sessions, userId, now) {
  const intervals = timerIntervals(sessions, now);
  const personalSeconds = intervals.filter(row => row.userId === userId).reduce((sum, row) => sum + Math.max(0, row.end - row.start), 0) / 1000;
  const ordered = intervals.slice().sort((a, b) => a.start - b.start);
  let union = 0, edge = null;
  for (const row of ordered) {
    if (edge == null || row.start > edge) { union += row.end - row.start; edge = row.end; }
    else if (row.end > edge) { union += row.end - edge; edge = row.end; }
  }
  const ownActive = intervals.find(row => row.userId === userId && row.active);
  return {
    individual_seconds: Math.floor(personalSeconds),
    group_seconds: Math.floor(Math.max(0, union) / 1000),
    active: Boolean(ownActive),
    active_started_at: ownActive ? new Date(ownActive.start).toISOString() : null,
    active_members: intervals.filter(row => row.active).length,
    updated_at: new Date(now).toISOString()
  };
}

async function studyTimerSummary(db, roomId, userId) {
  const now = Date.now();
  const open = await db.prepare('SELECT id,last_heartbeat_at FROM study_room_sessions WHERE room_id=? AND ended_at IS NULL').all(roomId);
  for (const session of open) {
    const heartbeat = millis(session.last_heartbeat_at);
    if (heartbeat != null && now - heartbeat > HEARTBEAT_GRACE_MS) {
      await db.prepare('UPDATE study_room_sessions SET ended_at=? WHERE id=? AND ended_at IS NULL').run(new Date(heartbeat).toISOString(), session.id);
    }
  }
  const sessions = await db.prepare('SELECT user_id,started_at,ended_at,last_heartbeat_at FROM study_room_sessions WHERE room_id=? ORDER BY started_at').all(roomId);
  return summarizeTimerSessions(sessions, userId, now);
}

export function installCommunityRoutes(app, { db, auth }) {
  app.get('/api/friends/search', auth, async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || email.length > 254 || !email.includes('@')) return res.status(400).json({ error: 'Enter a valid email address.' });
    const user = await db.prepare('SELECT id,name FROM users WHERE lower(email)=? AND id<>?').get(email, req.user.id);
    res.json({ user: user || null });
  });

  app.post('/api/friends/requests', auth, async (req, res) => {
    const targetId = String(req.body?.user_id || '');
    if (!targetId || targetId === req.user.id) return res.status(400).json({ error: 'Choose another VYOM user.' });
    if (!await db.prepare('SELECT id FROM users WHERE id=?').get(targetId)) return res.status(404).json({ error: 'User not found.' });
    const existing = await db.prepare("SELECT id,status FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) LIMIT 1").get(req.user.id, targetId, targetId, req.user.id);
    if (existing) return res.status(409).json({ error: existing.status === 'accepted' ? 'You are already friends.' : 'A friend request already exists.' });
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO friendships(id,requester_id,addressee_id) VALUES(?,?,?)').run(id, req.user.id, targetId);
    res.status(201).json({ request_id: id, status: 'pending' });
  });

  app.get('/api/friends', auth, async (req, res) => {
    const friends = await db.prepare("SELECT f.id AS friendship_id,u.id,u.name,f.created_at FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted' ORDER BY lower(u.name)").all(req.user.id, req.user.id, req.user.id);
    const requests = await db.prepare("SELECT f.id,u.id AS user_id,u.name,f.created_at FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.created_at DESC").all(req.user.id);
    res.json({ friends, requests });
  });

  app.post('/api/friends/requests/:id/accept', auth, async (req, res) => {
    const result = await db.prepare("UPDATE friendships SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND addressee_id=? AND status='pending'").run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Pending friend request not found.' });
    res.json({ ok: true });
  });

  app.delete('/api/friends/:id', auth, async (req, res) => {
    const result = await db.prepare('DELETE FROM friendships WHERE id=? AND (requester_id=? OR addressee_id=?)').run(req.params.id, req.user.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Friend connection not found.' });
    res.json({ ok: true });
  });

  app.get('/api/friends/leaderboard', auth, async (req, res) => {
    const links = await db.prepare("SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS user_id FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'").all(req.user.id, req.user.id, req.user.id);
    const ids = [req.user.id, ...links.map(row => row.user_id)];
    const marks = ids.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT u.id,u.name,COUNT(r.id) AS completed,ROUND(AVG(r.overall_score)) AS average_score FROM users u LEFT JOIN reports r ON r.user_id=u.id WHERE u.id IN (${marks}) GROUP BY u.id,u.name`).all(...ids);
    rows.sort((a, b) => Number(b.average_score || 0) - Number(a.average_score || 0) || Number(b.completed) - Number(a.completed) || String(a.name).localeCompare(String(b.name)));
    res.json({ leaderboard: rows.map((row, index) => ({ ...row, completed: Number(row.completed), average_score: row.average_score == null ? null : Number(row.average_score), rank: index + 1, me: row.id === req.user.id })) });
  });

  app.get('/api/leaderboard', auth, async (req, res) => {
    const scope = req.query.scope === 'global' ? 'global' : 'friends', period = req.query.period === 'weekly' ? 'weekly' : 'all';
    let ids = null;
    if (scope === 'friends') {
      const links = await db.prepare("SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS user_id FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'").all(req.user.id, req.user.id, req.user.id);
      ids = [...new Set([req.user.id, ...links.map(row => row.user_id)])];
    }
    const now = Date.now();
    res.json({ scope, period, leaderboard: await buildLeaderboard(db, ids, { period, meId: req.user.id, now }), updated_at: new Date(now).toISOString() });
  });

  app.post('/api/study-rooms', auth, async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Give your study room a name.' });
    const id = crypto.randomUUID(), code = crypto.randomBytes(5).toString('hex').toUpperCase();
    await db.prepare('INSERT INTO study_rooms(id,owner_id,name,join_code) VALUES(?,?,?,?)').run(id, req.user.id, name, code);
    await db.prepare('INSERT INTO study_room_members(room_id,user_id) VALUES(?,?)').run(id, req.user.id);
    res.status(201).json({ room: { id, name, join_code: code, owner: true } });
  });

  app.get('/api/study-rooms', auth, async (req, res) => {
    const rooms = await db.prepare('SELECT r.id,r.name,r.join_code,r.owner_id,r.created_at,COUNT(m.user_id) AS member_count FROM study_room_members mine JOIN study_rooms r ON r.id=mine.room_id JOIN study_room_members m ON m.room_id=r.id WHERE mine.user_id=? GROUP BY r.id ORDER BY r.created_at DESC').all(req.user.id);
    res.json({ rooms: rooms.map(room => ({ ...room, owner: room.owner_id === req.user.id, member_count: Number(room.member_count) })) });
  });

  app.post('/api/study-rooms/join', auth, async (req, res) => {
    const code = String(req.body?.join_code || '').trim().toUpperCase();
    const room = await db.prepare('SELECT id,name,join_code FROM study_rooms WHERE join_code=?').get(code);
    if (!room) return res.status(404).json({ error: 'Study room code not found.' });
    await db.prepare('INSERT INTO study_room_members(room_id,user_id) VALUES(?,?) ON CONFLICT(room_id,user_id) DO NOTHING').run(room.id, req.user.id);
    res.json({ room });
  });

  app.post('/api/study-rooms/:id/timer/start', auth, async (req, res) => {
    const member = await db.prepare('SELECT room_id FROM study_room_members WHERE room_id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ error: 'Study room not found.' });
    await studyTimerSummary(db, req.params.id, req.user.id);
    let session = await db.prepare('SELECT id FROM study_room_sessions WHERE room_id=? AND user_id=? AND ended_at IS NULL').get(req.params.id, req.user.id);
    if (!session) {
      const now = new Date().toISOString(), id = crypto.randomUUID();
      try { await db.prepare('INSERT INTO study_room_sessions(id,room_id,user_id,started_at,last_heartbeat_at) VALUES(?,?,?,?,?)').run(id, req.params.id, req.user.id, now, now); }
      catch (error) {
        if (error.code !== '23505' && !String(error.code || '').startsWith('SQLITE_CONSTRAINT')) throw error;
      }
      session = await db.prepare('SELECT id FROM study_room_sessions WHERE room_id=? AND user_id=? AND ended_at IS NULL').get(req.params.id, req.user.id);
    }
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ active: Boolean(session), timer: await studyTimerSummary(db, req.params.id, req.user.id) });
  });

  app.post('/api/study-rooms/:id/timer/heartbeat', auth, async (req, res) => {
    const member = await db.prepare('SELECT room_id FROM study_room_members WHERE room_id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ error: 'Study room not found.' });
    const now = new Date().toISOString();
    const result = await db.prepare('UPDATE study_room_sessions SET last_heartbeat_at=? WHERE room_id=? AND user_id=? AND ended_at IS NULL').run(now, req.params.id, req.user.id);
    if (!result.changes) return res.status(409).json({ error: 'Your study timer is not running.' });
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ active: true, heartbeat_at: now });
  });

  app.post('/api/study-rooms/:id/timer/stop', auth, async (req, res) => {
    const member = await db.prepare('SELECT room_id FROM study_room_members WHERE room_id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ error: 'Study room not found.' });
    await db.prepare('UPDATE study_room_sessions SET ended_at=? WHERE room_id=? AND user_id=? AND ended_at IS NULL').run(new Date().toISOString(), req.params.id, req.user.id);
    res.json({ active: false, timer: await studyTimerSummary(db, req.params.id, req.user.id) });
  });

  app.get('/api/study-rooms/:id', auth, async (req, res) => {
    const room = await db.prepare('SELECT r.id,r.name,r.owner_id,r.join_code,r.created_at FROM study_rooms r JOIN study_room_members m ON m.room_id=r.id WHERE r.id=? AND m.user_id=?').get(req.params.id, req.user.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(room.id, req.user.id);
    const members = await db.prepare("SELECT u.id,u.name,u.profile_image,m.last_seen_at FROM study_room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY lower(u.name)").all(room.id);
    const messages = await db.prepare('SELECT m.id,m.user_id,u.name,m.content,m.created_at FROM study_room_messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100').all(room.id);
    const timer = await studyTimerSummary(db, room.id, req.user.id);
    const sessions = await db.prepare('SELECT user_id,started_at,ended_at,last_heartbeat_at FROM study_room_sessions WHERE room_id=?').all(room.id);
    const now = Date.now(), { totals, active } = summarizeMemberStudy(sessions, now);
    const roomLeaderboard = members.map(member => ({
      user_id: member.id, name: member.name, profile_image: member.profile_image || null,
      study_seconds: Math.floor(totals.get(member.id) || 0),
      active: active.has(member.id), me: member.id === req.user.id
    })).sort((a, b) => b.study_seconds - a.study_seconds || String(a.name).localeCompare(String(b.name))).map((row, index) => ({ ...row, rank: index + 1 }));
    res.json({
      room: { ...room, owner: room.owner_id === req.user.id },
      members: members.map(member => ({ ...member, online: now - (millis(member.last_seen_at) || 0) < HEARTBEAT_GRACE_MS })),
      messages: messages.reverse(), timer, room_leaderboard: roomLeaderboard,
      room_progress: { total_focused_seconds: roomLeaderboard.reduce((sum, row) => sum + row.study_seconds, 0), sessions: sessions.length, active_members: active.size }
    });
  });

  app.post('/api/study-rooms/:id/messages', auth, async (req, res) => {
    const member = await db.prepare('SELECT room_id FROM study_room_members WHERE room_id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ error: 'Study room not found.' });
    const content = String(req.body?.content || '').trim();
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Message must contain 1 to 2,000 characters.' });
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO study_room_messages(id,room_id,user_id,content) VALUES(?,?,?,?)').run(id, req.params.id, req.user.id, content);
    const message = await db.prepare('SELECT m.id,m.user_id,u.name,m.content,m.created_at FROM study_room_messages m JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.room_id=?').get(id, req.params.id);
    res.status(201).json({ message });
  });

  app.delete('/api/study-rooms/:id/membership', auth, async (req, res) => {
    const room = await db.prepare('SELECT id,owner_id FROM study_rooms WHERE id=?').get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    if (room.owner_id === req.user.id) return res.status(409).json({ error: 'The room owner cannot leave. Delete the room from room settings.' });
    await db.prepare('UPDATE study_room_sessions SET ended_at=? WHERE room_id=? AND user_id=? AND ended_at IS NULL').run(new Date().toISOString(), room.id, req.user.id);
    const result = await db.prepare('DELETE FROM study_room_members WHERE room_id=? AND user_id=?').run(room.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'You are not a member of this room.' });
    res.json({ ok: true });
  });

  app.delete('/api/study-rooms/:id', auth, async (req, res) => {
    const result = await db.prepare('DELETE FROM study_rooms WHERE id=? AND owner_id=?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Owned study room not found.' });
    res.json({ ok: true });
  });
}
