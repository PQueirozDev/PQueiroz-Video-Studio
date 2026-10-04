export const api = window.studio

export function fmtTime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '--:--'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtTimePrecise(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
}

export function fmtSize(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1e3))} KB`
}

export function fmtAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000
  if (d < 60) return 'agora'
  if (d < 3600) return `há ${Math.floor(d / 60)} min`
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`
  if (d < 86400 * 7) return `há ${Math.floor(d / 86400)} d`
  return new Date(ts).toLocaleDateString('pt-BR')
}

export const mediaUrl = (path: string | null | undefined): string | undefined =>
  path ? api.app.toMediaUrl(path) : undefined

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
