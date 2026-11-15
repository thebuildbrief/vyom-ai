import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiBase = String(process.env.VITE_API_BASE_URL || '').trim();
if (process.env.VERCEL && !apiBase) {
  throw new Error('Set VITE_API_BASE_URL to the backend Vercel origin before building the frontend.');
}
if (/\/api\/?$/.test(apiBase)) {
  throw new Error('VITE_API_BASE_URL must be the backend origin without /api; the frontend adds /api.');
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } }
});
