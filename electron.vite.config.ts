import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    // mcp.js = servidor MCP das ferramentas do agente (processo separado, roda fora do app.asar).
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), mcp: resolve(__dirname, 'src/main/agent/mcp.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
