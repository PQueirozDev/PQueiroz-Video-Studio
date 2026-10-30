import type { SubtitleDocument, SubtitleCue } from './types'

export const emptySubtitles = (): SubtitleDocument => ({ cues: [], style: { size: 42, color: '#ffffff', position: 'bottom' } })

export function validateSubtitles(doc: SubtitleDocument): SubtitleDocument {
  if (!doc || !Array.isArray(doc.cues) || doc.cues.length > 10000) throw new Error('Legendas inválidas.')
  if (!doc.style || !Number.isFinite(doc.style.size) || doc.style.size < 16 || doc.style.size > 96 || !/^#[0-9a-f]{6}$/i.test(doc.style.color) || !['bottom', 'center', 'top'].includes(doc.style.position)) throw new Error('Estilo de legenda inválido.')
  const cues = doc.cues.map((c) => {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000) throw new Error('Cada legenda precisa de texto e de um fim maior que o início.')
    return { id: String(c.id), start: c.start, end: c.end, text: c.text.replace(/\r/g, '').replace(/\n\s*\n/g, '\n').trim() }
  }).sort((a, b) => a.start - b.start)
  if (cues.some((c, i) => i > 0 && c.start < cues[i - 1].end)) throw new Error('As legendas não podem se sobrepor.')
  return { cues, style: { ...doc.style } }
}

const stamp = (t: number): string => {
  const ms = Math.round(t * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}
export const toSrt = (doc: SubtitleDocument): string => validateSubtitles(doc).cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n')

export function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  for (const block of text.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const index = lines.findIndex((l) => l.includes('-->'))
    if (index < 0) throw new Error('Arquivo SRT inválido.')
    const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*$/.exec(lines[index])
    if (!m) throw new Error('Tempo inválido no SRT.')
    if ([2, 3, 6, 7].some((i) => Number(m[i]) > 59)) throw new Error('Tempo inválido no SRT.')
    const seconds = (n: number): number => Number(m[n]) * 3600 + Number(m[n + 1]) * 60 + Number(m[n + 2]) + Number(m[n + 3]) / 1000
    cues.push({ id: `srt-${cues.length}`, start: seconds(1), end: seconds(5), text: lines.slice(index + 1).join('\n') })
  }
  return validateSubtitles({ ...emptySubtitles(), cues }).cues
}

export function toAss(doc: SubtitleDocument, width: number, height: number): string {
  const valid = validateSubtitles(doc)
  const color = `&H00${valid.style.color.slice(5, 7)}${valid.style.color.slice(3, 5)}${valid.style.color.slice(1, 3)}`
  const align = { bottom: 2, center: 5, top: 8 }[valid.style.position]
  const assTime = (t: number): string => stamp(Math.floor(t * 100) / 100).replace(',', '.').slice(0, -1)
  const size = Math.round(valid.style.size * height / 1080)
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${size},${color},${color},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,${align},40,40,${Math.round(height * 0.06)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + valid.cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\n/g, '\\N')}`).join('\n')
}
