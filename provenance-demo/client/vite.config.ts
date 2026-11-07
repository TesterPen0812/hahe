import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Tailscale Serve forwards to 127.0.0.1; macOS otherwise binds Vite to IPv6 ::1 only
    host: '127.0.0.1',
    // Let the iPhone reach the dev server through Tailscale (or ngrok as a fallback)
    allowedHosts: ['.ts.net', '.ngrok-free.app', '.ngrok-free.dev'],
    // Send API calls from the page to the Express server
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
