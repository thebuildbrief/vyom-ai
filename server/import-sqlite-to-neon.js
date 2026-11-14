import './load-env.js';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { migrate } from './migrate.js';

const tables = ['users', 'user_profiles', 'resumes', 'interviews', 'messages', 'submissions', 'reports', 'auth_tokens', 'coding_test_results', 'friendships', 'study_rooms', 'study_room_members', 'study_room_messages', 'study_room_sessions'];
const sourcePath = process.env.SOURCE_SQLITE_PATH || process.env.DATABASE_PATH || './server/data/vyom.sqlite';
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL for the Neon migration target.');
const source = new Database(sourcePath, { readonly: true });
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1 });
const target = { dialect: 'postgres', pool, async exec(sql) { return pool.query(sql); }, prepare(sql) { let n=0;const query=sql.replace(/\?/g,()=>`$${++n}`);return{run:async(...params)=>pool.query(query,params)}; } };
try {
  await migrate(target);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      const exists = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      for (const row of rows) {
        const values = columns.map(column => {
          const value = row[column];
          if (table === 'users' && column === 'email_verified') return Boolean(value);
          if (table === 'coding_test_results' && column === 'passed') return Boolean(value);
          return value;
        });
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
      console.log(`Imported ${rows.length} ${table} rows (existing IDs kept).`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { source.close(); await pool.end(); }
