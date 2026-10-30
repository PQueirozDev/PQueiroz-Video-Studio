import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { applyCommand, emptyComposition, type MediaRef } from '@shared/composition'
import { effectById, transitionById } from '@shared/fx'
import { lutMap } from '../assets/luts'
import { runFfmpeg } from '../media/ffmpeg'
import { compileComposition, type RenderMedia } from './compose'
import { compositionArgs } from './encode'
import { fileStamp } from './preview'

// Prévias da biblioteca de efeitos: um vídeo curto (192x108) por transição/efeito/LUT, feito pelo
// mesmo motor do export sobre duas cenas de demonstração geradas localmente. Ficam em cache em
// <userData>/fx-previews e só são geradas quando a interface pede (uma de cada vez).

const W = 192
const H = 108
const VERSION = 1
let queue: Promise<unknown> = Promise.resolve()

function dir(): string {
  const d = join(app.getPath('userData'), 'fx-previews')
  mkdirSync(d, { recursive: true })
  return d
}

async function ff(args: string[]): Promise<void> {
  const r = await (await runFfmpeg(['-y', ...args], null, () => {})).done
  if (r.code !== 0) throw new Error(r.stderr.trim().split(/\r?\n/).slice(-2).join('\n') || 'ffmpeg falhou')
}

/** Duas cenas de demonstração (padrão colorido e fractal), geradas uma vez. */
async function demoMedia(): Promise<Map<string, RenderMedia>> {
  const a = join(dir(), 'demo-a.mp4')
  const b = join(dir(), 'demo-b.mp4')
  if (!existsSync(a)) await ff(['-f', 'lavfi', '-i', `testsrc2=s=${W * 2}x${H * 2}:r=24:d=2`, '-f', 'lavfi', '-i', 'sine=f=330:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', a])
  if (!existsSync(b)) await ff(['-f', 'lavfi', '-i', `mandelbrot=s=${W * 2}x${H * 2}:r=24`, '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b])
  const ref = (id: string, path: string, hasAudio: boolean): [string, RenderMedia] => [id, { id, kind: 'video', duration: 2, hasAudio, path } as MediaRef & { path: string }]
  return new Map([ref('a', a, true), ref('b', b, false)])
}

export function fxPreview(kind: 'transition' | 'effect' | 'lut', id: string): Promise<string> {
  if (!/^[\w-]{1,80}$/.test(id)) return Promise.reject(new Error('Prévia inválida.'))
  const job = queue.then(async () => {
    // LUT do usuário pode ser substituída com o mesmo nome: a versão do arquivo entra no nome da prévia.
    const lutPath = kind === 'lut' ? lutMap().get(id) : undefined
    const stamp = lutPath ? `-${createHash('sha1').update(lutPath + fileStamp(lutPath)).digest('hex').slice(0, 8)}` : ''
    const out = join(dir(), `${kind}-${id}${stamp}-v${VERSION}.mp4`)
    if (existsSync(out)) return out
    const media = await demoMedia()
    let n = 0
    const ctx = { media, newId: (p: string) => `${p}${++n}` }
    let doc = emptyComposition()
    if (kind === 'transition') {
      if (!transitionById(id)) throw new Error('Transição desconhecida.')
      doc = applyCommand(doc, { type: 'addClip', mediaId: 'a', in: 0, out: 1.2 }, ctx).doc
      const r = applyCommand(doc, { type: 'addClip', mediaId: 'b', in: 0, out: 1.2 }, ctx)
      doc = applyCommand(r.doc, { type: 'setTransition', clipId: r.createdId!, transition: { type: id, duration: 0.8 } }, ctx).doc
    } else {
      const def = kind === 'effect' ? effectById(id) : effectById('lut')
      if (!def || def.kind === 'audio') throw new Error('Este efeito não tem prévia visual.')
      const r = applyCommand(doc, { type: 'addClip', mediaId: 'a', in: 0, out: 1.6 }, ctx)
      // Mostra o efeito com intensidade visível: 60% do caminho entre o padrão e o extremo.
      const params = Object.fromEntries(def.params.map((p) => [p.key, p.default < p.max ? p.default + (p.max - p.default) * 0.6 : p.default - (p.default - p.min) * 0.6]))
      doc = applyCommand(r.doc, { type: 'addEffect', clipId: r.createdId!, effect: def.id, params: def.id === 'color-grade' ? { saturation: 1.5, contrast: 1.3, temperature: 5000 } : params, asset: kind === 'lut' ? id : undefined }, ctx).doc
    }
    const graph = compileComposition(doc, media, { w: W, h: H, fps: 24 }, { luts: lutMap() })
    const script = `${out}.filter`
    const tmp = `${out}.part.mp4`
    writeFileSync(script, graph.filter, 'utf8')
    try {
      await ff(compositionArgs(graph, script, ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30'], tmp).slice(1))
      renameSync(tmp, out)
      return out
    } finally {
      try { unlinkSync(script) } catch { /* já removido */ }
      try { unlinkSync(tmp) } catch { /* já renomeado */ }
    }
  })
  queue = job.catch(() => {})
  return job
}
