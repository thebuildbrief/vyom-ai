import db from './database.js';

if (db.dialect !== 'postgres') throw new Error('Neon verification requires DATABASE_URL to select PostgreSQL.');
const required = ['users','interviews','messages','resumes','reports','submissions','user_profiles','auth_tokens','coding_test_results','friendships','study_rooms','study_room_members','study_room_messages','study_room_sessions'];
const client = await db.pool.connect();
try {
  const ping = await client.query('SELECT 1 AS connected');
  if (Number(ping.rows[0]?.connected) !== 1) throw new Error('Neon connection query returned an unexpected result.');
  const schema = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [required]);
  const found = new Set(schema.rows.map(row => row.table_name));
  const missing = required.filter(name => !found.has(name));
  if (missing.length) throw new Error(`Neon schema is missing required tables: ${missing.join(', ')}`);
  const resumeAnalysis = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='resumes' AND column_name='analysis'");
  if (!resumeAnalysis.rowCount) throw new Error('Neon schema is missing resumes.analysis.');
  const versions = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  if (!versions.rows.some(row => Number(row.version) === 5)) throw new Error('Neon migration version 5 is not recorded.');

  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE vyom_connection_smoke(id INTEGER PRIMARY KEY, value TEXT NOT NULL) ON COMMIT DROP');
  await client.query('INSERT INTO vyom_connection_smoke(id,value) VALUES(1,$1)', ['roundtrip']);
  const roundtrip = await client.query('SELECT value FROM vyom_connection_smoke WHERE id=1');
  if (roundtrip.rows[0]?.value !== 'roundtrip') throw new Error('Neon write/read smoke check failed.');
  await client.query('COMMIT');
  console.log(`Neon PostgreSQL connected; ${required.length} required application tables, resume analysis column, and migration v5 are present; transactional write/read passed.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await db.close();
}
