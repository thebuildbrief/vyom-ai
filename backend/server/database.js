import './load-env.js';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import fs from 'node:fs';
import path from 'node:path';

const postgres = Boolean(process.env.DATABASE_URL);
if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && !postgres) throw new Error('DATABASE_URL is required in production; SQLite files are only supported for local development.');
let db;
if (postgres) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 5), idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true } });
  if (process.env.VERCEL) attachDatabasePool(pool);
  db = {
    dialect: 'postgres', pool,
    prepare(sql) {
      let index = 0;
      const query = sql.replace(/\?/g, () => `$${++index}`);
      return {
        async get(...params) { return (await pool.query(query, params)).rows[0]; },
        async all(...params) { return (await pool.query(query, params)).rows; },
        async run(...params) { const result = await pool.query(query, params); return { changes: result.rowCount }; }
      };
    },
    async exec(sql) { return pool.query(sql); },
    async close() { return pool.end(); }
  };
} else {
  const { default: Database } = await import('better-sqlite3');
  const filename = process.env.DATABASE_PATH || './server/data/vyom.sqlite';
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL'); sqlite.pragma('foreign_keys = ON');
  db = { dialect: 'sqlite', raw: sqlite, prepare(sql) { const statement = sqlite.prepare(sql), normalize = values => values.map(value => typeof value === 'boolean' ? Number(value) : value); return { get: (...values) => statement.get(...normalize(values)), all: (...values) => statement.all(...normalize(values)), run: (...values) => statement.run(...normalize(values)) }; }, exec: sql => sqlite.exec(sql), pragma: (...args) => sqlite.pragma(...args), transaction: fn => sqlite.transaction(fn), close: () => sqlite.close() };
}
export default db;
