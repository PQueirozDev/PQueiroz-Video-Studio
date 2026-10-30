import { clipEnd, clipLength, mediaRefOf, type Command, type Composition, type MediaRef } from './composition'
import type { ExportPreset } from './exportPresets'

// Quality Check: problemas que estragam a entrega, achados antes de exportar (na timeline) e depois (no arquivo).
// Cada item diz o que é, onde está e, quando dá, traz os comandos que corrigem (botão "Corrigir").

export type QcLevel = 'erro' | 'aviso' | 'info'

export interface QcItem {
  level: QcLevel
  code: string
  message: string
  /** Tempo na timeline (ou no arquivo, nas verificações do render). */
  time?: number
  clipId?: string
  fix?: Command[]
  fixLabel?: string
}

const r1 = (v: number): number => Math.round(v * 10) / 10
const r3 = (v: number): number => Math.round(v * 1000) / 1000
const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

export interface QcContext {
  media: Map<string, MediaRef>
  /** Fontes instaladas (ids); títulos com fonte ausente caem na fonte padrão. */
  fonts?: Set<string>
  luts?: Set<string>
  preset?: ExportPreset
  /** Proporção (largura/altura) da timeline: com destino de outra proporção, posições são convertidas pelo encaixe. */
  aspect?: number
}

/**
 * Onde um ponto da timeline (0–1) cai no quadro do destino. "pad"/"blur" encolhem a imagem para caber
 * (centralizada); "crop" amplia e corta as bordas (o ponto pode sair do quadro).
 */
export function mapToExport(aspect: number, preset: ExportPreset): { sx: number; sy: number } {
  const [a, b] = preset.aspect.split(':').map(Number)
  const target = a / b
  if (Math.abs(target - aspect) < 0.01) return { sx: 1, sy: 1 }
  const wider = aspect > target
  if (preset.fit === 'crop') return wider ? { sx: aspect / target, sy: 1 } : { sx: 1, sy: target / aspect }
  return wider ? { sx: 1, sy: target / aspect } : { sx: aspect / target, sy: 1 }
}

export function checkComposition(doc: Composition, ctx: QcContext): QcItem[] {
  const out: QcItem[] = []
  const add = (i: QcItem): void => void out.push(i)
  if (!doc.clips.length) return [{ level: 'erro', code: 'vazia', message: 'A timeline está vazia.' }]
  const duration = Math.max(...doc.clips.map(clipEnd))
  const visual = new Set(doc.tracks.filter((t) => t.kind === 'video' && !t.hidden).map((t) => t.id))
  const audible = new Set(doc.tracks.filter((t) => !t.muted).map((t) => t.id))
  const preset = ctx.preset

  // Mídia ausente / LUT ausente.
  for (const c of doc.clips) {
    if (!mediaRefOf(ctx.media, c)) add({ level: 'erro', code: 'midia-ausente', message: `Clipe em ${fmt(c.start)} usa um arquivo que saiu do projeto.`, time: c.start, clipId: c.id })
    for (const e of c.effects) {
      if (e.type === 'lut' && e.asset && ctx.luts && !ctx.luts.has(e.asset)) {
        add({ level: 'erro', code: 'lut-ausente', message: `A LUT "${e.asset}" do clipe em ${fmt(c.start)} não está instalada.`, time: c.start, clipId: c.id, fix: [{ type: 'removeEffect', clipId: c.id, effectId: e.id }], fixLabel: 'Tirar a LUT' })
      }
    }
  }

  // Tela preta: trechos sem nenhuma imagem (todas as trilhas de vídeo visíveis vazias).
  const covers = doc.clips.filter((c) => visual.has(c.trackId) && !c.title).map((c) => [c.start, clipEnd(c)] as const).sort((a, b) => a[0] - b[0])
  let reach = 0
  for (const [s, e] of covers) {
    if (s - reach > 0.15) {
      const gap = s - reach
      const start = reach
      // Correção: puxa para trás TUDO o que vem depois (vídeo, títulos, áudio, marcadores), sem desfazer transições.
      // Só quando nada começa dentro do buraco nem o atravessa (senão algo sairia do lugar).
      const fixable = !doc.clips.some((c) => (c.start > start + 0.001 && c.start < s - 0.001) || (c.start < s - 0.001 && clipEnd(c) > s + 0.001 && c.start > start - 0.001))
      add({ level: 'aviso', code: 'tela-preta', message: `Tela preta de ${r1(gap)} s em ${fmt(start)}.`, time: start,
        ...(fixable ? { fix: [{ type: 'shiftTime', from: r3(s), delta: r3(-gap) }], fixLabel: 'Fechar o buraco' } : {}) })
    }
    reach = Math.max(reach, e)
  }
  // Fim sem imagem (ex.: música continua depois do último vídeo).
  if (duration - reach > 0.15) add({ level: 'aviso', code: 'tela-preta', message: `Tela preta de ${r1(duration - reach)} s no final (${fmt(reach)} até o fim).`, time: reach })

  // Clipes curtíssimos (piscadas) fora de grupos (rampas e montagens na batida são intencionais).
  for (const c of doc.clips) {
    if (!visual.has(c.trackId) || c.title || c.group) continue
    if (clipLength(c) < 0.25) add({ level: 'aviso', code: 'clipe-curto', message: `Clipe de ${Math.round(clipLength(c) * 100) / 100} s em ${fmt(c.start)} vira uma piscada.`, time: c.start, clipId: c.id, fix: [{ type: 'removeClip', clipId: c.id, ripple: true }], fixLabel: 'Remover' })
  }

  // Títulos e legendas: tamanho, tempo de leitura, fonte, área segura do destino.
  const safe = preset?.safe
  const aspectOf = (): number => ctx.aspect ?? (preset ? Number(preset.aspect.split(':')[0]) / Number(preset.aspect.split(':')[1]) : 16 / 9)
  for (const c of doc.clips) {
    const t = c.title
    if (!t || !visual.has(c.trackId)) continue
    const len = clipLength(c)
    const chars = t.text.replace(/\s+/g, ' ').trim().length
    // Tamanho no quadro do destino (encaixar 16:9 num vertical encolhe o texto).
    const sy = preset ? mapToExport(aspectOf(), preset).sy : 1
    if (t.size * sy < 0.035) add({ level: 'aviso', code: 'texto-pequeno', message: `Texto "${t.text.slice(0, 30)}" muito pequeno para celular${sy < 1 ? ` no ${preset!.name}` : ''}.`, time: c.start, clipId: c.id, fix: [{ type: 'updateTitle', clipId: c.id, title: { size: r3(Math.min(0.4, 0.045 / sy)) } }], fixLabel: 'Aumentar' })
    if (chars / len > 22 && chars > 12) add({ level: 'aviso', code: 'leitura-rapida', message: `"${t.text.slice(0, 30)}" fica ${r1(len)} s na tela: rápido demais para ler (${Math.round(chars / len)} letras/s).`, time: c.start, clipId: c.id })
    if (ctx.fonts && !ctx.fonts.has(t.font)) add({ level: 'aviso', code: 'fonte-ausente', message: `A fonte "${t.font}" não está instalada; o título usa a fonte padrão.`, time: c.start, clipId: c.id })
    if (safe && preset) {
      // Tudo no quadro do destino: (timeline → destino) e de volta para a correção.
      const { sx } = mapToExport(aspectOf(), preset)
      const toX = (v: number): number => 0.5 + (v - 0.5) * sx
      const toY = (v: number): number => 0.5 + (v - 0.5) * sy
      const lines = t.text.split('\n').length
      const half = ((lines * t.size * t.lineSpacing) / 2) * sy
      const ey = toY(t.y)
      const ex = toX(t.x)
      let y = ey
      if (ey + half > 1 - safe.bottom) y = 1 - safe.bottom - half
      if (ey - half < safe.top) y = safe.top + half
      // A âncora x (borda ou centro do texto) precisa ficar dentro das margens laterais.
      const outX = ex > 1 - safe.right + 0.001 || ex < safe.left - 0.001
      if (Math.abs(y - ey) > 0.005 || outX) {
        const x = Math.min(1 - safe.right, Math.max(safe.left, ex))
        const back = (v: number, s: number): number => r3(Math.min(1, Math.max(0, 0.5 + (v - 0.5) / s)))
        const cut = ex < 0 || ex > 1 || ey < 0 || ey > 1
        add({ level: 'aviso', code: 'area-segura', message: cut ? `"${t.text.slice(0, 30)}" fica fora do quadro no ${preset.name} (o enquadramento corta as bordas).` : `"${t.text.slice(0, 30)}" fica sob a interface do ${preset.name} (botões/legenda do app).`, time: c.start, clipId: c.id,
          fix: [{ type: 'updateTitle', clipId: c.id, title: { y: back(y, sy), x: back(x, sx) } }], fixLabel: 'Mover para a área segura' })
      }
    }
  }

  // Duração do destino.
  if (preset?.maxDuration && duration > preset.maxDuration + 0.05) add({ level: 'erro', code: 'longo-demais', message: `${preset.name} aceita até ${preset.maxDuration} s; a edição tem ${r1(duration)} s.` })

  // Som.
  const sound = doc.clips.filter((c) => audible.has(c.trackId) && !c.title && (mediaRefOf(ctx.media, c)?.hasAudio ?? false) && c.hold <= 0 && (c.volume > 0 || c.keyframes.volume?.length))
  if (!sound.length) add({ level: 'aviso', code: 'sem-som', message: 'O vídeo vai sair mudo (nenhum clipe com som ativo).' })
  else if (!doc.mix.normalize) add({ level: 'aviso', code: 'sem-normalizar', message: 'Volume final não normalizado: pode sair baixo ou estourado nas redes (-14 LUFS é o padrão).', fix: [{ type: 'setMix', mix: { normalize: true, targetLufs: preset?.loudness ?? -14 } }], fixLabel: 'Normalizar' })
  const loud = doc.clips.filter((c) => audible.has(c.trackId) && c.volume > 1.5)
  for (const c of loud) add({ level: 'info', code: 'volume-alto', message: `Clipe em ${fmt(c.start)} com volume ${Math.round(c.volume * 100)}%: risco de distorcer.`, time: c.start, clipId: c.id, fix: [{ type: 'setClipProps', clipId: c.id, volume: 1 }], fixLabel: 'Voltar a 100%' })
  const order: Record<QcLevel, number> = { erro: 0, aviso: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.time ?? 0) - (b.time ?? 0))
}

/** Medidas do arquivo renderizado (ffprobe + ebur128 + detectores) → itens do Quality Check. */
export interface RenderMeasures {
  duration: number
  width: number
  height: number
  bytes: number
  integrated: number | null
  truePeak: number | null
  black: { start: number; end: number }[]
  silence: { start: number; end: number }[]
  freeze: { start: number; end: number }[]
  hasAudio: boolean
}

export function checkRender(m: RenderMeasures, preset?: ExportPreset): QcItem[] {
  const out: QcItem[] = []
  const target = preset?.loudness ?? -14
  if (!m.hasAudio) out.push({ level: 'aviso', code: 'sem-audio', message: 'O arquivo não tem faixa de áudio.' })
  else {
    if (m.integrated != null && Math.abs(m.integrated - target) > 2) out.push({ level: 'aviso', code: 'loudness', message: `Volume médio ${r1(m.integrated)} LUFS (o ideal é ${target}). Ative "Normalizar volume final" na mixagem.` })
    if (m.truePeak != null && m.truePeak > -1) out.push({ level: 'aviso', code: 'pico', message: `Pico de ${r1(m.truePeak)} dBTP: pode distorcer depois da compressão das redes (ideal ≤ -1).` })
  }
  // Pretos e congelamentos no começo/fim curtos são normais (fades).
  for (const b of m.black) {
    if (b.end - b.start < 0.5 || (b.start < 0.05 && b.end < 1) || (m.duration - b.end < 0.05 && b.end - b.start < 1)) continue
    out.push({ level: 'aviso', code: 'preto', message: `Tela preta de ${r1(b.end - b.start)} s em ${fmt(b.start)}.`, time: b.start })
  }
  for (const s of m.silence) if (s.end - s.start >= 3) out.push({ level: 'info', code: 'silencio', message: `Silêncio de ${r1(s.end - s.start)} s em ${fmt(s.start)}.`, time: s.start })
  for (const f of m.freeze) if (f.end - f.start >= 2) out.push({ level: 'info', code: 'congelado', message: `Imagem parada por ${r1(f.end - f.start)} s em ${fmt(f.start)} (é intencional?).`, time: f.start })
  if (preset) {
    const want = preset.aspect.split(':').map(Number)
    if (Math.abs(m.width / m.height - want[0] / want[1]) > 0.02) out.push({ level: 'erro', code: 'proporcao', message: `Proporção ${m.width}x${m.height} diferente de ${preset.aspect} (${preset.name}).` })
    if (preset.maxBytes && m.bytes > preset.maxBytes) out.push({ level: 'erro', code: 'tamanho', message: `Arquivo com ${r1(m.bytes / 1048576)} MB: passa do limite de ${r1(preset.maxBytes / 1048576)} MB do ${preset.name}.` })
    if (preset.maxDuration && m.duration > preset.maxDuration + 0.5) out.push({ level: 'erro', code: 'duracao', message: `${r1(m.duration)} s: passa do limite de ${preset.maxDuration} s do ${preset.name}.` })
  }
  const order: Record<QcLevel, number> = { erro: 0, aviso: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.time ?? 0) - (b.time ?? 0))
}

/** Uma passada do FFmpeg que mede tudo do Quality Check do arquivo (sem gravar saída). */
export function qcAnalysisArgs(path: string, hasAudio: boolean): string[] {
  return ['-hide_banner', '-nostats', '-i', path, '-vf', 'blackdetect=d=0.5:pix_th=0.05,freezedetect=n=0.003:d=2',
    ...(hasAudio ? ['-af', 'ebur128=peak=true,silencedetect=n=-50dB:d=2'] : []), '-f', 'null', '-']
}
/** Linhas do log que interessam (o resto pode ser descartado durante a leitura). */
export const QC_LOG_LINE = /black_start|silence_(start|end)|freeze_(start|end)/

/** Lê os relatórios dos filtros de análise no stderr do FFmpeg. */
/**
 * `events` = linhas dos detectores (cada uma uma vez); `summary` = fim do log com o resumo do ebur128.
 * Intervalos que não terminam (ex.: imagem parada até o fim) fecham em `duration`.
 */
export function parseQcLog(events: string, summaryLog = events, duration?: number): Pick<RenderMeasures, 'integrated' | 'truePeak' | 'black' | 'silence' | 'freeze'> {
  const log = events
  const ranges = (startRe: RegExp, endRe: RegExp): { start: number; end: number }[] => {
    const starts = [...log.matchAll(startRe)].map((m) => Number(m[1]))
    const ends = [...log.matchAll(endRe)].map((m) => Number(m[1]))
    return starts.map((s, i) => ({ start: s, end: ends[i] ?? duration ?? s }))
  }
  // O resumo do ebur128 vem no fim: "I: -14.2 LUFS" e "Peak: -1.3 dBFS" dentro de "True peak:".
  const summary = summaryLog.slice(summaryLog.lastIndexOf('Summary:'))
  const black = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }))
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(summary)
  const p = /True peak:\s*\r?\n\s*Peak:\s+(-?[\d.]+|-inf)/.exec(summary)
  return {
    integrated: i ? Number(i[1]) : null,
    truePeak: p ? (p[1] === '-inf' ? -Infinity : Number(p[1])) : null,
    black,
    silence: ranges(/silence_start: (-?[\d.]+)/g, /silence_end: (-?[\d.]+)/g),
    freeze: ranges(/freeze_start: ([\d.]+)/g, /freeze_end: ([\d.]+)/g)
  }
}

