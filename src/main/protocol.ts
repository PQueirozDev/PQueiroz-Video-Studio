import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { app, protocol } from 'electron'
import { isInside } from './files'
import { getSettings } from './settings'

// "studio-media://file/<caminho codificado>" — serve vídeos/imagens locais para o player,
// com suporte a Range (necessário para arrastar a timeline do <video>).

export const SCHEME = 'studio-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
}

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

/** Só serve arquivos das pastas do estúdio (projetos, exportação, E:\aqc e dados do app). */
function allowed(path: string): boolean {
  const s = getSettings()
  return [s.projectsRoot, s.exportRoot, s.aqcRoot, s.assetsRoot, app.getPath('userData')].some((root) => root && isInside(root, path))
}

export function handleMediaProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!existsSync(path) || !allowed(path)) return new Response('Not found', { status: 404 })
    const size = statSync(path).size
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (!range) {
      const body = Readable.toWeb(createReadStream(path)) as ReadableStream
      return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
    }
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type, 'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes'
      }
    })
  })
}
