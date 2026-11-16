import crypto from 'node:crypto';

const HEARTBEAT_GRACE_MS = 45_000;
const WEEK_MS = 7 * 864e5;
const POMODORO_DEFAULT = { focus: 1500, break: 300 };
// SQLite CURRENT_TIMESTAMP is UTC without a zone; parse it as UTC, not local time.
const millis = value => {
  if (value == null) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`).getTime();
  return new Date(value).getTime();
};

const LEVELS = [
  { min: 0, name: 'Curious' },
  { min: 250, name: 'Explorer' },
  { min: 600, name: 'Builder' },
  { min: 1100, name: 'Achiever' },
  { min: 1800, name: 'Specialist' },
  { min: 2700, name: 'Expert' },
  { min: 3800, name: 'Mentor' },
  { min: 5200, name: 'Leader' },
  { min: 7000, name: 'Elite' },
  { min: 10000, name: 'Legend' }
];

export const BADGES = [
  { id: 'beginner', name: 'Beginner', symbol: '✦', description: 'Complete your first interview.', earned: row => row.completed >= 1 },
  { id: 'rising_star', name: 'Rising Star', symbol: '✧', description: 'Complete 3 interviews with a 70% average.', earned: row => row.completed >= 3 && Number(row.averageScore) >= 70 },
  { id: 'consistent_learner', name: 'Consistent Learner', symbol: '◷', description: 'Track 1 hour of focused study time.', earned: row => row.studySeconds >= 3600 },
  { id: 'coding_champion', name: 'Coding Champion', symbol: '⌘', description: 'Solve 5 coding problems.', earned: row => row.solved >= 5 },
  { id: 'interview_pro', name: 'Interview Pro', symbol: '◈', description: 'Complete 10 interviews.', earned: row => row.completed >= 10 },
  { id: 'weekly_warrior', name: 'Weekly Warrior', symbol: '⚡', description: 'Earn 100 points in the last seven days.', earned: row => row.weeklyPoints >= 100 },
  { id: 'top_performer', name: 'Top Performer', symbol: '♛', description: 'Reach the top three on a leaderboard.', earned: row => row.rank <= 3 && row.xp > 0 },
  { id: 'elite_achiever', name: 'Elite Achiever', symbol: '◆', description: 'Reach 5,000 lifetime points.', earned: row => row.xp >= 5000 },
  { id: 'focus_master', name: 'Focus Master', symbol: '◎', description: 'Track 10 hours of focused study time.', earned: row => row.studySeconds >= 36000 }
];

const badgeCatalog = BADGES.map(({ earned, ...badge }) => badge);

function levelFor(xp) {
  let index = 0;
  for (let position = 0; position < LEVELS.length; position += 1) if (xp >= LEVELS[position].min) index = position;
  const current = LEVELS[index], next = LEVELS[index + 1];
  return {
    level: index + 1,
    level_name: current.name,
    level_xp: current.min,
    next_level_xp: next ? next.min : null,
    xp_to_next: next ? Math.max(0, next.min - xp) : 0,
    level_progress: next ? Math.min(100, Math.round(((xp - current.min) / (next.min - current.min)) * 100)) : 100
  };
}

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

function emptyActivity() {
  return { completed: 0, scoreTotal: 0, codingPassed: 0, codingTotal: 0, solved: new Set(), studySeconds: 0 };
}

async function buildLeaderboard(db, userIds, { period, meId, now }) {
  const users = userIds
    ? await db.prepare(`SELECT id,name,profile_image FROM users WHERE id IN (${userIds.map(() => '?').join(',')}) ORDER BY created_at`).all(...userIds)
    : await db.prepare('SELECT id,name,profile_image FROM users ORDER BY created_at').all();
  if (!users.length) return { rows: [], me: null, total: 0 };
  const ids = users.map(user => user.id), marks = ids.map(() => '?').join(',');
  const [reports, submissions, sessions] = await Promise.all([
    db.prepare(`SELECT user_id,overall_score,created_at FROM reports WHERE user_id IN (${marks})`).all(...ids),
    db.prepare(`SELECT id,user_id,problem_key,result,created_at FROM submissions WHERE user_id IN (${marks}) AND mode='submit'`).all(...ids),
    db.prepare(`SELECT user_id,started_at,ended_at,last_heartbeat_at FROM study_room_sessions WHERE user_id IN (${marks})`).all(...ids)
  ]);
  const activityFor = startMs => {
    const activity = new Map(ids.map(id => [id, emptyActivity()]));
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
    for (const [userId, seconds] of studySecondsByUser(sessions, now, startMs, now)) {
      const row = activity.get(userId);
      if (row) row.studySeconds = Math.floor(seconds);
    }
    return activity;
  };
  const lifetime = activityFor(-Infinity), weekly = activityFor(now - WEEK_MS);
  const scored = users.map(user => {
    const all = lifetime.get(user.id), week = weekly.get(user.id), selected = period === 'weekly' ? week : all;
    const averageScore = selected.completed ? Math.round(selected.scoreTotal / selected.completed) : null;
    const lifetimeAverage = all.completed ? Math.round(all.scoreTotal / all.completed) : null;
    const points = leaderboardPoints({ completed: selected.completed, averageScore, codingPassed: selected.codingPassed, codingSolved: selected.solved.size, studySeconds: selected.studySeconds });
    const weeklyPoints = leaderboardPoints({ completed: week.completed, averageScore: week.completed ? Math.round(week.scoreTotal / week.completed) : null, codingPassed: week.codingPassed, codingSolved: week.solved.size, studySeconds: week.studySeconds });
    const xp = leaderboardPoints({ completed: all.completed, averageScore: lifetimeAverage, codingPassed: all.codingPassed, codingSolved: all.solved.size, studySeconds: all.studySeconds });
    return {
      id: user.id, name: user.name, profile_image: user.profile_image || null,
      points, xp, weekly_points: weeklyPoints, ...levelFor(xp),
      completed_interviews: selected.completed, average_score: averageScore,
      coding_passed: selected.codingPassed, coding_total: selected.codingTotal, coding_solved: selected.solved.size,
      study_seconds: selected.studySeconds, me: user.id === meId,
      points_breakdown: { interviews: selected.completed * 50, reports: averageScore ?? 0, coding: selected.codingPassed * 5 + selected.solved.size * 15, study: Math.floor(selected.studySeconds / 60) * 2 },
      badge_context: { completed: all.completed, averageScore: lifetimeAverage, studySeconds: all.studySeconds, solved: all.solved.size, weeklyPoints, xp }
    };
  });
  scored.sort((a, b) => b.points - a.points || b.completed_interviews - a.completed_interviews || Number(b.average_score || 0) - Number(a.average_score || 0) || String(a.name).localeCompare(String(b.name)));
  const ranked = scored.map((row, index) => {
    const rank = index + 1, badges = BADGES.filter(badge => badge.earned({ ...row.badge_context, rank })).map(badge => badge.id);
    const { badge_context, ...publicRow } = row;
    return { ...publicRow, rank, badges, badge_count: badges.length };
  });
  const top = ranked.slice(0, 100);
  const current = ranked.find(row => row.id === meId) || null;
  if (current && !top.some(row => row.id === meId)) top.push(current);
  const above = current && current.rank > 1 ? ranked[current.rank - 2] : null;
  const me = current ? { ...current, next_rank: above ? above.rank : null, next_name: above ? above.name : null, points_to_next: above ? Math.max(1, above.points - current.points + 1) : 0 } : null;
  return { rows: top, me, total: ranked.length };
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

function pomodoroState(room, now = Date.now()) {
  const phase = room.pomodoro_phase === 'break' ? 'break' : 'focus';
  const duration = Math.min(3600, Math.max(60, Number(room.pomodoro_duration) || POMODORO_DEFAULT[phase]));
  const stored = Math.max(0, Number(room.pomodoro_elapsed) || 0);
  const running = Boolean(room.pomodoro_started_at);
  const elapsed = running ? stored + Math.max(0, (now - (millis(room.pomodoro_started_at) || now)) / 1000) : stored;
  return {
    phase, duration, elapsed: Math.floor(elapsed), remaining: Math.max(0, Math.ceil(duration - elapsed)),
    running, started_at: room.pomodoro_started_at || null, complete: elapsed >= duration
  };
}

async function logRoomEvent(db, roomId, userId, type, detail = '') {
  try { await db.prepare('INSERT INTO study_room_events(id,room_id,user_id,type,detail) VALUES(?,?,?,?,?)').run(crypto.randomUUID(), roomId, userId, type, String(detail).slice(0, 300)); }
  catch { /* Activity history must never block the room action itself. */ }
}

async function settlePomodoro(db, room, now = Date.now()) {
  const state = pomodoroState(room, now);
  if (!state.complete) return { room, state };
  const phase = state.phase === 'focus' ? 'break' : 'focus', duration = POMODORO_DEFAULT[phase];
  await db.prepare('UPDATE study_rooms SET pomodoro_phase=?,pomodoro_duration=?,pomodoro_started_at=NULL,pomodoro_elapsed=0 WHERE id=?').run(phase, duration, room.id);
  await logRoomEvent(db, room.id, null, 'pomodoro_complete', `${state.phase === 'focus' ? 'Focus' : 'Break'} session completed`);
  return { room: { ...room, pomodoro_phase: phase, pomodoro_duration: duration, pomodoro_started_at: null, pomodoro_elapsed: 0 }, state: { phase, duration, elapsed: 0, remaining: duration, running: false, started_at: null, complete: false } };
}

async function roomMembership(db, roomId, userId) {
  return db.prepare('SELECT room_id FROM study_room_members WHERE room_id=? AND user_id=?').get(roomId, userId);
}

async function onlineCount(db, roomId, now) {
  const members = await db.prepare('SELECT last_seen_at FROM study_room_members WHERE room_id=?').all(roomId);
  return members.filter(member => now - (millis(member.last_seen_at) || 0) < HEARTBEAT_GRACE_MS).length;
}

const roomSummary = room => ({
  ...room, owner: Boolean(room.owner), member_count: Number(room.member_count) || 0,
  online_count: Number(room.online_count) || 0, visibility: room.visibility === 'public' ? 'public' : 'private'
});

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
    const now = Date.now(), board = await buildLeaderboard(db, ids, { period, meId: req.user.id, now });
    res.json({ scope, period, leaderboard: board.rows, me: board.me, total: board.total, badge_catalog: badgeCatalog, updated_at: new Date(now).toISOString() });
  });

  app.post('/api/study-rooms', auth, async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80), description = String(req.body?.description || '').trim().slice(0, 300);
    const visibility = req.body?.visibility === 'public' ? 'public' : 'private';
    if (!name) return res.status(400).json({ error: 'Give your study room a name.' });
    const id = crypto.randomUUID(), code = crypto.randomBytes(5).toString('hex').toUpperCase();
    await db.prepare('INSERT INTO study_rooms(id,owner_id,name,description,visibility,join_code) VALUES(?,?,?,?,?,?)').run(id, req.user.id, name, description, visibility, code);
    await db.prepare('INSERT INTO study_room_members(room_id,user_id) VALUES(?,?)').run(id, req.user.id);
    await logRoomEvent(db, id, req.user.id, 'room_created', `${name} was created`);
    res.status(201).json({ room: { id, name, description, visibility, join_code: code, owner: true, role: 'owner' } });
  });

  app.get('/api/study-rooms', auth, async (req, res) => {
    const rooms = await db.prepare('SELECT r.id,r.name,r.description,r.visibility,r.join_code,r.owner_id,r.created_at,COUNT(m.user_id) AS member_count FROM study_room_members mine JOIN study_rooms r ON r.id=mine.room_id JOIN study_room_members m ON m.room_id=r.id WHERE mine.user_id=? GROUP BY r.id ORDER BY r.created_at DESC').all(req.user.id);
    const now = Date.now(), online = new Map();
    for (const room of rooms) online.set(room.id, await onlineCount(db, room.id, now));
    res.json({ rooms: rooms.map(room => roomSummary({ ...room, owner: room.owner_id === req.user.id, online_count: online.get(room.id), role: room.owner_id === req.user.id ? 'owner' : 'member' })) });
  });

  app.get('/api/study-rooms/public', auth, async (req, res) => {
    const rooms = await db.prepare("SELECT r.id,r.name,r.description,r.visibility,r.owner_id,r.created_at,u.name AS owner_name,COUNT(m.user_id) AS member_count FROM study_rooms r JOIN users u ON u.id=r.owner_id LEFT JOIN study_room_members m ON m.room_id=r.id WHERE r.visibility='public' GROUP BY r.id,u.name ORDER BY r.created_at DESC LIMIT 50").all();
    const memberships = await db.prepare('SELECT room_id FROM study_room_members WHERE user_id=?').all(req.user.id), joined = new Set(memberships.map(row => row.room_id));
    const now = Date.now(), items = [];
    for (const room of rooms) items.push(roomSummary({ ...room, owner: room.owner_id === req.user.id, online_count: await onlineCount(db, room.id, now), joined: joined.has(room.id), role: room.owner_id === req.user.id ? 'owner' : joined.has(room.id) ? 'member' : null }));
    items.sort((a, b) => b.online_count - a.online_count || b.member_count - a.member_count || String(a.name).localeCompare(String(b.name)));
    res.json({ rooms: items });
  });

  app.post('/api/study-rooms/join', auth, async (req, res) => {
    const code = String(req.body?.join_code || '').trim().toUpperCase();
    const room = await db.prepare('SELECT id,name,description,visibility,join_code,owner_id FROM study_rooms WHERE join_code=?').get(code);
    if (!room) return res.status(404).json({ error: 'Study room code not found.' });
    const existing = await roomMembership(db, room.id, req.user.id);
    await db.prepare('INSERT INTO study_room_members(room_id,user_id) VALUES(?,?) ON CONFLICT(room_id,user_id) DO NOTHING').run(room.id, req.user.id);
    if (!existing) await logRoomEvent(db, room.id, req.user.id, 'member_joined', 'Joined with an invite code');
    res.json({ room: { ...room, role: room.owner_id === req.user.id ? 'owner' : 'member' } });
  });

  app.post('/api/study-rooms/:id/join', auth, async (req, res) => {
    const room = await db.prepare('SELECT id,name,description,visibility,join_code,owner_id FROM study_rooms WHERE id=?').get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    const existing = await roomMembership(db, room.id, req.user.id);
    if (!existing && room.visibility !== 'public') return res.status(403).json({ error: 'This private room requires an invite code.' });
    await db.prepare('INSERT INTO study_room_members(room_id,user_id) VALUES(?,?) ON CONFLICT(room_id,user_id) DO NOTHING').run(room.id, req.user.id);
    if (!existing) await logRoomEvent(db, room.id, req.user.id, 'member_joined', 'Joined the public room');
    res.json({ room: { ...room, role: room.owner_id === req.user.id ? 'owner' : 'member' } });
  });

  app.post('/api/study-rooms/:id/timer/start', auth, async (req, res) => {
    if (!await roomMembership(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Study room not found.' });
    await studyTimerSummary(db, req.params.id, req.user.id);
    let session = await db.prepare('SELECT id FROM study_room_sessions WHERE room_id=? AND user_id=? AND ended_at IS NULL').get(req.params.id, req.user.id);
    if (!session) {
      const now = new Date().toISOString(), id = crypto.randomUUID();
      try { await db.prepare('INSERT INTO study_room_sessions(id,room_id,user_id,started_at,last_heartbeat_at) VALUES(?,?,?,?,?)').run(id, req.params.id, req.user.id, now, now); }
      catch (error) {
        if (error.code !== '23505' && !String(error.code || '').startsWith('SQLITE_CONSTRAINT')) throw error;
      }
      session = await db.prepare('SELECT id FROM study_room_sessions WHERE room_id=? AND user_id=? AND ended_at IS NULL').get(req.params.id, req.user.id);
      await logRoomEvent(db, req.params.id, req.user.id, 'timer_started', 'Started a focus timer');
    }
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ active: Boolean(session), timer: await studyTimerSummary(db, req.params.id, req.user.id) });
  });

  app.post('/api/study-rooms/:id/timer/heartbeat', auth, async (req, res) => {
    if (!await roomMembership(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Study room not found.' });
    const now = new Date().toISOString();
    const result = await db.prepare('UPDATE study_room_sessions SET last_heartbeat_at=? WHERE room_id=? AND user_id=? AND ended_at IS NULL').run(now, req.params.id, req.user.id);
    if (!result.changes) return res.status(409).json({ error: 'Your study timer is not running.' });
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ active: true, heartbeat_at: now });
  });

  app.post('/api/study-rooms/:id/timer/stop', auth, async (req, res) => {
    if (!await roomMembership(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Study room not found.' });
    const ended = await db.prepare('UPDATE study_room_sessions SET ended_at=? WHERE room_id=? AND user_id=? AND ended_at IS NULL').run(new Date().toISOString(), req.params.id, req.user.id);
    if (ended.changes) await logRoomEvent(db, req.params.id, req.user.id, 'timer_stopped', 'Paused their focus timer');
    res.json({ active: false, timer: await studyTimerSummary(db, req.params.id, req.user.id) });
  });

  app.post('/api/study-rooms/:id/pomodoro', auth, async (req, res) => {
    if (!await roomMembership(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Study room not found.' });
    const action = String(req.body?.action || 'start'), now = Date.now();
    let room = await db.prepare('SELECT * FROM study_rooms WHERE id=?').get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    const settled = await settlePomodoro(db, room, now);
    room = settled.room;
    let state = settled.state;
    if (action === 'start' || action === 'resume') {
      if (!state.running) {
        await db.prepare('UPDATE study_rooms SET pomodoro_started_at=?,pomodoro_elapsed=? WHERE id=?').run(new Date(now).toISOString(), state.elapsed, room.id);
        state = { ...state, running: true, started_at: new Date(now).toISOString(), remaining: Math.max(0, state.duration - state.elapsed) };
        await logRoomEvent(db, room.id, req.user.id, 'pomodoro_started', `Started the shared ${state.phase} timer`);
      }
    } else if (action === 'pause') {
      if (state.running) {
        await db.prepare('UPDATE study_rooms SET pomodoro_started_at=NULL,pomodoro_elapsed=? WHERE id=?').run(state.elapsed, room.id);
        state = { ...state, running: false, started_at: null };
        await logRoomEvent(db, room.id, req.user.id, 'pomodoro_paused', `Paused the shared ${state.phase} timer`);
      }
    } else if (action === 'reset') {
      await db.prepare("UPDATE study_rooms SET pomodoro_phase='focus',pomodoro_duration=?,pomodoro_started_at=NULL,pomodoro_elapsed=0 WHERE id=?").run(POMODORO_DEFAULT.focus, room.id);
      state = { phase: 'focus', duration: POMODORO_DEFAULT.focus, elapsed: 0, remaining: POMODORO_DEFAULT.focus, running: false, started_at: null, complete: false };
      await logRoomEvent(db, room.id, req.user.id, 'pomodoro_reset', 'Reset the shared Pomodoro timer');
    } else if (action === 'skip' || action === 'switch') {
      const phase = action === 'switch' && req.body?.phase === 'break' ? 'break' : state.phase === 'focus' ? 'break' : 'focus';
      const duration = POMODORO_DEFAULT[phase];
      await db.prepare('UPDATE study_rooms SET pomodoro_phase=?,pomodoro_duration=?,pomodoro_started_at=NULL,pomodoro_elapsed=0 WHERE id=?').run(phase, duration, room.id);
      state = { phase, duration, elapsed: 0, remaining: duration, running: false, started_at: null, complete: false };
      await logRoomEvent(db, room.id, req.user.id, 'pomodoro_phase', `Switched to a ${phase} session`);
    } else return res.status(400).json({ error: 'Choose a valid Pomodoro action.' });
    res.json({ pomodoro: state });
  });

  app.get('/api/study-rooms/:id', auth, async (req, res) => {
    const room = await db.prepare('SELECT r.*,u.name AS owner_name FROM study_rooms r JOIN users u ON u.id=r.owner_id JOIN study_room_members m ON m.room_id=r.id WHERE r.id=? AND m.user_id=?').get(req.params.id, req.user.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(room.id, req.user.id);
    const settled = await settlePomodoro(db, room);
    const members = await db.prepare("SELECT u.id,u.name,u.profile_image,m.last_seen_at FROM study_room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY lower(u.name)").all(room.id);
    const messages = await db.prepare('SELECT m.id,m.user_id,u.name,m.content,m.created_at FROM study_room_messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100').all(room.id);
    const events = await db.prepare('SELECT e.id,e.type,e.detail,e.created_at,u.name FROM study_room_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.room_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 30').all(room.id);
    const timer = await studyTimerSummary(db, room.id, req.user.id);
    const sessions = await db.prepare('SELECT user_id,started_at,ended_at,last_heartbeat_at FROM study_room_sessions WHERE room_id=?').all(room.id);
    const now = Date.now(), { totals, active } = summarizeMemberStudy(sessions, now);
    const nowMillis = now;
    const memberRows = members.map(member => ({ ...member, online: nowMillis - (millis(member.last_seen_at) || 0) < HEARTBEAT_GRACE_MS, role: member.id === room.owner_id ? 'owner' : 'member' }));
    const roomLeaderboard = memberRows.map(member => ({
      user_id: member.id, name: member.name, profile_image: member.profile_image || null,
      study_seconds: Math.floor(totals.get(member.id) || 0),
      active: active.has(member.id), me: member.id === req.user.id
    })).sort((a, b) => b.study_seconds - a.study_seconds || String(a.name).localeCompare(String(b.name))).map((row, index) => ({ ...row, rank: index + 1 }));
    res.json({
      room: { ...settled.room, owner: room.owner_id === req.user.id, role: room.owner_id === req.user.id ? 'owner' : 'member', member_count: members.length, online_count: memberRows.filter(member => member.online).length },
      members: memberRows,
      messages: messages.reverse(),
      events: events.reverse(),
      timer,
      pomodoro: settled.state,
      room_leaderboard: roomLeaderboard,
      room_progress: { total_focused_seconds: roomLeaderboard.reduce((sum, row) => sum + row.study_seconds, 0), sessions: sessions.length, active_members: active.size, completed: sessions.filter(session => session.ended_at).length }
    });
  });

  app.post('/api/study-rooms/:id/settings', auth, async (req, res) => {
    const room = await db.prepare('SELECT id,owner_id,name,description,visibility FROM study_rooms WHERE id=?').get(req.params.id);
    if (!room) return res.status(404).json({ error: 'Study room not found.' });
    if (room.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the room owner can change these settings.' });
    const name = req.body?.name === undefined ? room.name : String(req.body.name).trim().slice(0, 80);
    const description = req.body?.description === undefined ? room.description : String(req.body.description).trim().slice(0, 300);
    const visibility = req.body?.visibility === undefined ? room.visibility : req.body.visibility === 'public' ? 'public' : 'private';
    if (!name) return res.status(400).json({ error: 'Give your study room a name.' });
    await db.prepare('UPDATE study_rooms SET name=?,description=?,visibility=? WHERE id=?').run(name, description, visibility, room.id);
    await logRoomEvent(db, room.id, req.user.id, 'room_updated', 'Updated the room details');
    res.json({ room: { ...room, name, description, visibility } });
  });

  app.post('/api/study-rooms/:id/messages', auth, async (req, res) => {
    if (!await roomMembership(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Study room not found.' });
    const content = String(req.body?.content || '').trim();
    if (!content || content.length > 2000) return res.status(400).json({ error: 'Message must contain 1 to 2,000 characters.' });
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO study_room_messages(id,room_id,user_id,content) VALUES(?,?,?,?)').run(id, req.params.id, req.user.id, content);
    await db.prepare('UPDATE study_room_members SET last_seen_at=CURRENT_TIMESTAMP WHERE room_id=? AND user_id=?').run(req.params.id, req.user.id);
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
    await logRoomEvent(db, room.id, req.user.id, 'member_left', 'Left the room');
    res.json({ ok: true });
  });

  app.delete('/api/study-rooms/:id', auth, async (req, res) => {
    const result = await db.prepare('DELETE FROM study_rooms WHERE id=? AND owner_id=?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Owned study room not found.' });
    res.json({ ok: true });
  });
}
