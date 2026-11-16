import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const keys = ['DATABASE_URL', 'DATABASE_PATH', 'NODE_ENV', 'VERCEL', 'OPENAI_API_KEY', 'JDOODLE_CLIENT_ID', 'JDOODLE_CLIENT_SECRET', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'MAIL_API_KEY', 'MAIL_FROM', 'GOOGLE_CLIENT_ID', 'DEMO_ACCOUNTS'];

async function startServer(t) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = '';
  process.env.DATABASE_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL;
  for (const key of keys) if (!['DATABASE_URL', 'DATABASE_PATH', 'NODE_ENV', 'VERCEL'].includes(key)) delete process.env[key];

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
  return `http://127.0.0.1:${server.address().port}`;
}

test('config endpoint reports only boolean capability flags and leaks no secrets', async t => {
  const base = await startServer(t);
  process.env.OPENAI_API_KEY = 'test-key-that-must-not-leak';
  process.env.JDOODLE_CLIENT_ID = 'jd-id';
  process.env.JDOODLE_CLIENT_SECRET = 'jd-secret';
  process.env.S3_BUCKET = 'bucket';
  process.env.S3_ACCESS_KEY_ID = 's3-id';
  process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
  process.env.MAIL_API_KEY = 'mail-key';
  process.env.MAIL_FROM = 'vyom@example.com';
  process.env.GOOGLE_CLIENT_ID = 'google-id';
  process.env.DEMO_ACCOUNTS = 'true';

  const response = await fetch(`${base}/api/index.js?__api_path=%2Fapi%2Fconfig`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    aiChatConfigured: true,
    realtimeVoiceConfigured: true,
    codeExecutionConfigured: true,
    resumeStorageConfigured: true,
    emailConfigured: true,
    googleSignInConfigured: true,
    demoAccountsEnabled: true
  });
  assert.ok(!JSON.stringify(body).includes('test-key-that-must-not-leak'));
  assert.ok(!JSON.stringify(body).includes('s3-secret'));
});

test('config endpoint flags capabilities as false when env vars are missing', async t => {
  const base = await startServer(t);
  const response = await fetch(`${base}/api/index.js?__api_path=%2Fapi%2Fconfig`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    aiChatConfigured: false,
    realtimeVoiceConfigured: false,
    codeExecutionConfigured: false,
    resumeStorageConfigured: false,
    emailConfigured: false,
    googleSignInConfigured: false,
    demoAccountsEnabled: false
  });
});
