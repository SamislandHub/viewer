import { defineConfig } from 'electron-vite'

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
  renderer: {}
})
