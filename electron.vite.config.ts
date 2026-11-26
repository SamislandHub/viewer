import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('./src/renderer/', import.meta.url))

// electron-vite spawns Electron with `.` by default. With "type": "module"
// that entry does not start our main process, so point it at the built file.
process.env.ELECTRON_ENTRY ||= 'out/main/index.js'

// Some host environments export this; it would turn Electron into plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

// Electron's own sandbox cannot initialise in restricted desktop sessions.
// electron-vite forwards this as `--no-sandbox`. Override with NO_SANDBOX=0 if needed.
process.env.NO_SANDBOX ||= '1'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          main: resolve(rendererRoot, 'index.html'),
          controls: resolve(rendererRoot, 'controls.html'),
          settings: resolve(rendererRoot, 'settings.html'),
          home: resolve(rendererRoot, 'home.html'),
          bookmarks: resolve(rendererRoot, 'bookmarks.html'),
          history: resolve(rendererRoot, 'history.html'),
          downloads: resolve(rendererRoot, 'downloads.html')
        }
      }
    }
  }
})
