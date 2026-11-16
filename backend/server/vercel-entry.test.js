import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

test('combined Vercel entry handles rewritten API requests', async t => {
  const keys = ['DATABASE_URL', 'DATABASE_PATH', 'NODE_ENV', 'VERCEL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = '';
  process.env.DATABASE_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;

  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  const { default: handler } = await import('../../api/index.js');
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/index.js?__api_path=%2Fapi%2Fhealth`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'sqlite' });
});
