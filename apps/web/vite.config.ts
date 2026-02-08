import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Allow accessing the dev server via LAN/hostname (e.g. skippy.theclarks.home)
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Vite 5+ host check: allow specific hostnames
    allowedHosts: ['skippy.theclarks.home'],
  },
})
