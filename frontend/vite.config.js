import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiBase = String(process.env.VITE_API_BASE_URL || '').trim();
if (apiBase && /\/api\/?$/.test(apiBase)) {
  throw new Error('VITE_API_BASE_URL must be the backend origin without /api; the frontend adds /api.');
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
  preview: { proxy: { '/api': 'http://localhost:4000' } }
});
