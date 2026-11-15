import app from '../server/index.js';

export default function handler(req, res) {
  // Vercel's rewrite targets this single function. Restore the original API path
  // before Express matches it, while retaining the caller's query parameters.
  if (typeof req.url === 'string') {
    const url = new URL(req.url, 'http://localhost');
    const originalPath = url.searchParams.get('__api_path');
    if (originalPath?.startsWith('/api/')) {
      url.searchParams.delete('__api_path');
      req.url = `${originalPath}${url.search ? `?${url.searchParams}` : ''}`;
    }
  }
  return app(req, res);
}
