import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Let the iPhone reach the dev server through any ngrok address
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev'],
    // Send API calls from the page to the Express server
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})