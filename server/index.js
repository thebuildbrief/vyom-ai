import './load-env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import db from './database.js';
import { migrate } from './migrate.js';
import { installAccountRoutes } from './accounts.js';
import { installResumeRoutes } from './resume-routes.js';
import { installAiRoutes } from './ai-coding-routes.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const secret = process.env.JWT_SECRET || 'development-only-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Set a JWT_SECRET of at least 32 characters before starting in production.');
}
// SQLite development schema is upgraded on startup. Production PostgreSQL
// migrations use DATABASE_URL_UNPOOLED through the explicit migration CLI.
if (db.dialect === 'sqlite') await migrate(db);

// Express 4 does not forward rejected promises to the error middleware by itself.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const register = app[method].bind(app);
  app[method] = (...args) => register(...args.map(value => typeof value === 'function'
    ? ((req, res, next) => Promise.resolve(value(req, res, next)).catch(next))
    : value));
}

const allowedOrigins = ['https://vyom-ai-flame.vercel.app', process.env.CLIENT_ORIGIN, process.env.APP_ORIGIN, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null]
  .filter(Boolean).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
if (!allowedOrigins.length) allowedOrigins.push('http://localhost:5173');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: { directives: {
  'default-src': ["'self'"], 'script-src': ["'self'", 'https://accounts.google.com'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'connect-src': ["'self'", 'https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://api.openai.com', 'wss://api.openai.com'],
  'frame-src': ["'self'", 'https://accounts.google.com'], 'media-src': ["'self'", 'blob:'], 'img-src': ["'self'", 'data:', 'blob:']
} } }));
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
});
const cookieOpts = { httpOnly: true, sameSite: (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase(), secure: process.env.NODE_ENV === 'production' || (process.env.COOKIE_SAME_SITE || '').toLowerCase() === 'none', maxAge: 7 * 864e5 };
const auth = (req, res, next) => {
  try { const token = req.cookies?.vyom || req.headers.authorization?.replace(/^Bearer /, ''); if (!token) throw Error(); req.user = jwt.verify(token, secret); next(); }
  catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
};
app.use((req, _res, next) => {
  req.cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) { const [key, ...value] = part.trim().split('='); if (key) req.cookies[key] = decodeURIComponent(value.join('=')); }
  next();
});

app.locals.db = db;
installAccountRoutes(app, { db, auth, secret, cookieOpts });
installResumeRoutes(app, { db, auth });
app.post('/api/auth/logout', (_req, res) => res.clearCookie('vyom', { httpOnly: true, sameSite: cookieOpts.sameSite, secure: cookieOpts.secure }).json({ ok: true }));
app.get('/api/auth/me', auth, async (req, res) => {
  const user = await db.prepare('SELECT id,name,email,created_at FROM users WHERE id=?').get(req.user.id);
  res.json({ user: user || null });
});
app.get('/api/health', async (_req, res) => {
  try { if (db.dialect === 'postgres') await db.pool.query('SELECT 1'); else db.prepare('SELECT 1').get(); res.json({ status: 'ok', database: db.dialect }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.get('/api/dashboard', auth, async (req, res) => {
  const interviews = await db.prepare('SELECT id,role,type,difficulty,status,created_at FROM interviews WHERE user_id=? ORDER BY created_at DESC LIMIT 8').all(req.user.id);
  const scores = (await db.prepare('SELECT overall_score FROM reports WHERE user_id=?').all(req.user.id)).map(row => Number(row.overall_score)).filter(Number.isFinite);
  const row = await db.prepare("SELECT COALESCE(SUM(duration),0) AS seconds FROM interviews WHERE user_id=? AND status='completed'").get(req.user.id);
  res.json({ interviews, stats: { completed: scores.length, averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null, hours: Math.round(Number(row.seconds || 0) / 60 * 10) / 10 } });
});
app.post('/api/interviews', auth, async (req, res) => {
  const body = req.body || {}, id = crypto.randomUUID();
  const resumeId = body.resume_id || null;
  if (resumeId && !await db.prepare('SELECT id FROM resumes WHERE id=? AND user_id=?').get(resumeId, req.user.id)) return res.status(404).json({ error: 'Resume not found.' });
  await db.prepare('INSERT INTO interviews(id,user_id,role,type,difficulty,duration,interviewer,language,company,topics,resume_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, String(body.role || 'Software Engineer').slice(0, 100), String(body.type || 'Technical').slice(0, 50), String(body.difficulty || 'Medium').slice(0, 20), Math.min(60, Math.max(10, Number(body.duration) || 20)), String(body.interviewer || 'Samarth').slice(0, 50), String(body.language || 'Python').slice(0, 30), String(body.company || '').slice(0, 100), String(body.topics || '').slice(0, 500), resumeId);
  res.status(201).json({ interview: await db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(id, req.user.id) });
});
const owned = async (req, res, next) => {
  try { const item = await db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!item) return res.status(404).json({ error: 'Interview not found.' }); req.interview = item; next(); }
  catch (error) { next(error); }
};
installAiRoutes(app, { db, auth, owned });
app.get('/api/interviews/:id', auth, owned, async (req, res) => {
  const messages = await db.prepare('SELECT id,role,content,created_at FROM messages WHERE interview_id=? AND user_id=? ORDER BY created_at,id').all(req.interview.id, req.user.id);
  res.json({ interview: req.interview, messages });
});
app.get('/api/interviews/:id/report', auth, owned, async (req, res) => {
  const report = await db.prepare('SELECT * FROM reports WHERE interview_id=? AND user_id=?').get(req.interview.id, req.user.id);
  if (!report) return res.status(404).json({ error: 'Report is not available yet.' });
  res.json({ ...report, details: JSON.parse(report.details) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use('/api', (err, _req, res, _next) => {
  console.error('API request failed:', err.message);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'The request could not be completed.' });
});

export default app;
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') app.listen(port, () => console.log(`VYOM API ready on http://localhost:${port}`));
