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
  server: {
    port: 5173,
    /**
     * Fail instead of hunting for a free port.
     *
     * Vite's default is to increment when 5173 is taken, so a dev server that
     * was never shut down is invisible: the next `npm run dev` quietly starts
     * on 5174, then 5175, and each orphan keeps holding its port and its
     * memory. Failing loudly turns a silent leak into an error that names the
     * problem, and `npm run dev:kill` clears it.
     */
    strictPort: true,
  },
})
