import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: [
      'servers-billion-barbara-signatures.trycloudflare.com',
      'reno-sunday-myrtle-deadline.trycloudflare.com',
      ],
    proxy: {
      '/api': {
        target: 'http://localhost:5188',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:5188',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
