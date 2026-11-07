import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Let the iPhone reach the dev server through Tailscale (or ngrok as a fallback)
    allowedHosts: ['.ts.net', '.ngrok-free.app', '.ngrok-free.dev'],
    // Send API calls from the page to the Express server
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
