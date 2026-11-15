import './load-env.js';
import { Pool } from 'pg';
import { migrate } from './migrate.js';

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL to the Neon branch to migrate.');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 10_000 });
const db = {
  dialect: 'postgres',
  async exec(sql) { return pool.query(sql); },
  prepare(sql) {
    let index = 0;
    const query = sql.replace(/\?/g, () => `$${++index}`);
    return { run: async (...params) => pool.query(query, params) };
  }
};
try {
  await migrate(db);
  console.log('Neon schema migration completed (additive, idempotent DDL only).');
} catch (error) {
  console.error(`Neon schema migration failed: ${error.code || 'database error'}. No credentials were printed.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
