import { join } from 'node:path'
import { app } from 'electron'

/** Script do servidor MCP: fora do app.asar no app instalado (o Node do Electron roda o arquivo direto). */
export function mcpServerPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main', 'mcp.js') : join(__dirname, 'mcp.js')
}
