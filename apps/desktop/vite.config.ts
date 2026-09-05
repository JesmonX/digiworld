import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), {
    name: 'design-preview-fixtures',
    configureServer(server) {
      server.middlewares.use('/__design-plugin', async (req, res, next) => {
        const name = req.url?.slice(1)
        if (!name || !['keyboard-heatmap', 'agent-token-heatmap', 'mail-assistant', 'github-actions', 'server-monitor', 'calendar-todo'].includes(name)) return next()
        try {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(await readFile(path.resolve(import.meta.dirname, '../../plugins', name, 'ui/dist/index.html')))
        } catch { res.statusCode = 404; res.end('Build plugin frontends first') }
      })
    },
  }],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    cors: true,
    hmr: !process.env.CI,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: ['es2022', 'chrome105', 'safari13'],
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
})
