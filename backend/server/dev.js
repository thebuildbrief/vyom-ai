// Local development must not inherit a deployment DATABASE_URL from an env file.
process.env.DATABASE_URL = '';
process.env.NODE_ENV ||= 'development';
await import('./index.js');
