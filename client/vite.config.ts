import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, /api is proxied to the Express server on :4000
// so the frontend and backend can run on separate ports without CORS fuss.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
