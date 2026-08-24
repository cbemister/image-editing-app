import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  /**
   * Served from the domain root by default. Set BASE_PATH to deploy under a
   * subfolder — e.g. a GitHub Pages project site:
   *
   *   BASE_PATH=/staff-photo-cropper/ npm run build
   *
   * Every asset path in the app is derived from this, including the service
   * worker scope and the MediaPipe model URLs.
   */
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
