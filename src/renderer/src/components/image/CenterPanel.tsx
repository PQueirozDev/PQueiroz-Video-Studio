import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Circle, Clapperboard, Columns2, Download, Grid3x3, Image as ImageIcon, Maximize, Minus, Plus, Redo2, RotateCcw, Save, Scan, Shapes, Sparkles,
  Square, Star, Type, Undo2, X
} from 'lucide-react'
import type { EffectKind, ImageDoc, ShapeKind } from '@shared/image'
import { effectLayer, imageLayer, shapeLayer, textLayer } from '@shared/imageDoc'
import { paletteOf } from '@shared/templates'
import { api, cx, fmtAgo, mediaUrl } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { Button, IconButton } from '../ui'
import { CanvasView, DocCanvas } from './CanvasView'

function Menu({ icon, label, children }: { icon: ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <IconButton title={label} active={open} onClick={() => setOpen(!open)}>{icon}</IconButton>
      {open && (
        <div className="absolute left-0 top-8 z-30 min-w-[170px] rounded-lg border border-line-2 bg-panel-2 p-1 shadow-xl shadow-black/50 animate-pop">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const MenuItem = ({ onClick, children }: { onClick(): void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted hover:bg-raised hover:text-fg">{children}</button>
)

function Toolbar({ onExport, onVideo }: { onExport(): void; onVideo(): void }) {
  const { doc, info, brands, addLayer, undo, redo, past, future, zoom, setZoom, showSafe, showGrid, compare, setCompare, saveVersion, projectId, saving, pendingSave } = useImage()
  const versions = useStore((s) => s.versions)
  const toast = useStore((s) => s.toast)
  if (!doc) return null
  const p = paletteOf(brands.find((b) => b.id === info?.brandId) ?? null)
  const brand = brands.find((b) => b.id === info?.brandId)
  const cx0 = doc.width / 2, cy0 = doc.height / 2
  const m = Math.min(doc.width, doc.height)

  const addText = (kind: 'title' | 'body'): void => {
    const w = doc.width * 0.8
    addLayer(textLayer(kind === 'title' ? 'Título da arte' : 'Texto de apoio', cx0 - w / 2, cy0 - m * 0.08, w, kind === 'title' ? m * 0.16 : m * 0.1, {
      font: (kind === 'title' ? brand?.fonts.heading : brand?.fonts.body) || 'Segoe UI', weight: kind === 'title' ? 900 : 500, size: kind === 'title' ? m * 0.1 : m * 0.045,
      shadow: kind === 'title' ? { color: 'rgba(0,0,0,0.45)', blur: 24, x: 0, y: 8 } : null
    }))
  }
  const addShape = (shape: ShapeKind): void => {
    const s = m * (shape === 'line' ? 0.5 : 0.3)
    addLayer(shapeLayer(shape, cx0 - s / 2, cy0 - (shape === 'line' ? m * 0.01 : s / 2), s, shape === 'line' ? m * 0.02 : s, { type: 'solid', color: p.primary }, { radius: shape === 'rect' ? m * 0.02 : 0, name: { rect: 'Retângulo', ellipse: 'Círculo', burst: 'Selo', triangle: 'Triângulo', line: 'Barra', blob: 'Forma orgânica' }[shape] }))
  }
  const addEffect = (effect: EffectKind): void => {
    addLayer(effectLayer(effect, doc, [p.accent, p.light, p.secondary], { name: { rays: 'Raios de luz', glow: 'Brilho', bokeh: 'Bokeh', confetti: 'Confete', sparkles: 'Brilhos', vignette: 'Vinheta', grain: 'Granulado' }[effect], blend: effect === 'bokeh' || effect === 'rays' ? 'screen' : 'normal', opacity: effect === 'rays' ? 0.35 : 1 }), effect === 'vignette' || effect === 'grain' ? undefined : Math.max(0, doc.layers.findIndex((l) => l.role !== 'background')))
  }
  const addImage = async (): Promise<void> => {
    if (!projectId) return
    const imgs = await api.image.pickImages(projectId)
    for (const img of imgs) {
      const w = Math.min(doc.width * 0.6, img.width)
      const h = (w * img.height) / img.width
      addLayer(imageLayer(img.path, Math.round(cx0 - w / 2), Math.round(cy0 - h / 2), Math.round(w), Math.round(h), { name: img.path.split(/[\\/]/).pop() ?? 'Imagem' }))
    }
  }

  const zoomPct = zoom === 'fit' ? 'Ajustar' : `${Math.round(zoom * 100)}%`
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2">
      <IconButton title="Adicionar título" onClick={() => addText('title')}><Type className="h-4 w-4" /></IconButton>
      <Menu icon={<Shapes className="h-4 w-4" />} label="Adicionar forma">
        {(close) => (['rect', 'ellipse', 'burst', 'line', 'triangle', 'blob'] as ShapeKind[]).map((s) => (
          <MenuItem key={s} onClick={() => { addShape(s); close() }}>
            {s === 'rect' ? <Square className="h-3.5 w-3.5" /> : s === 'ellipse' ? <Circle className="h-3.5 w-3.5" /> : s === 'burst' ? <Star className="h-3.5 w-3.5" /> : <Shapes className="h-3.5 w-3.5" />}
            {{ rect: 'Retângulo / faixa', ellipse: 'Círculo', burst: 'Selo (promoção)', line: 'Barra / sublinhado', triangle: 'Triângulo', blob: 'Forma orgânica' }[s]}
          </MenuItem>
        ))}
      </Menu>
      <IconButton title="Adicionar imagem" onClick={addImage}><ImageIcon className="h-4 w-4" /></IconButton>
      <Menu icon={<Sparkles className="h-4 w-4" />} label="Adicionar efeito">
        {(close) => (['rays', 'glow', 'bokeh', 'confetti', 'sparkles', 'vignette', 'grain'] as EffectKind[]).map((e) => (
          <MenuItem key={e} onClick={() => { addEffect(e); close() }}>
            <Sparkles className="h-3.5 w-3.5" />{{ rays: 'Raios de luz', glow: 'Brilho / luz', bokeh: 'Bokeh', confetti: 'Confete', sparkles: 'Brilhos', vignette: 'Vinheta', grain: 'Granulado' }[e]}
          </MenuItem>
        ))}
      </Menu>
      <div className="mx-1.5 h-5 w-px bg-line" />
      <IconButton title="Desfazer (Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 className="h-4 w-4" /></IconButton>
      <IconButton title="Refazer (Ctrl+Y)" disabled={!future.length} onClick={redo}><Redo2 className="h-4 w-4" /></IconButton>
      <div className="mx-1.5 h-5 w-px bg-line" />
      <IconButton title="Diminuir zoom (Ctrl −)" onClick={() => setZoom(Math.max(0.05, (zoom === 'fit' ? 0.4 : zoom) / 1.25))}><Minus className="h-4 w-4" /></IconButton>
      <button type="button" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} className="h-7 min-w-[58px] rounded-md px-1.5 font-mono text-[11px] text-muted hover:bg-raised" title="100% / ajustar à tela (Ctrl 0)">{zoomPct}</button>
      <IconButton title="Aumentar zoom (Ctrl +)" onClick={() => setZoom(Math.min(4, (zoom === 'fit' ? 0.4 : zoom) * 1.25))}><Plus className="h-4 w-4" /></IconButton>
      <IconButton title="Ajustar à tela" onClick={() => setZoom('fit')}><Maximize className="h-4 w-4" /></IconButton>
      <IconButton title="Mostrar área segura do formato" active={showSafe} onClick={() => useImage.setState({ showSafe: !showSafe })}><Scan className="h-4 w-4" /></IconButton>
      <IconButton title="Grade (terços)" active={showGrid} onClick={() => useImage.setState({ showGrid: !showGrid })}><Grid3x3 className="h-4 w-4" /></IconButton>
      <IconButton title="Comparar versões" active={Boolean(compare)} disabled={!versions.length} onClick={() => {
        if (compare) setCompare(null)
        else {
          const last = versions[versions.length - 1]
          setCompare({ a: versions.length > 1 ? versions[versions.length - 2].id : last.id, b: 'atual' })
        }
      }}><Columns2 className="h-4 w-4" /></IconButton>
      <span className="ml-2 text-[10.5px] text-faint">{saving ? 'Salvando…' : pendingSave ? 'Alterações não salvas' : 'Salvo'}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => saveVersion('Edição manual', 'Versão salva pelo Pedro').catch(() => toast('Falha ao salvar versão', 'bad'))} title="Salvar versão (Ctrl+S)"><Save className="h-3.5 w-3.5" />Salvar versão</Button>
        <Button size="sm" onClick={onVideo} title="Transformar em vídeo animado no Video Studio"><Clapperboard className="h-3.5 w-3.5" />Enviar para Video Studio</Button>
        <Button size="sm" variant="primary" onClick={onExport}><Download className="h-3.5 w-3.5" />Exportar</Button>
      </div>
    </div>
  )
}

function useVersionDoc(versionId: string | null): ImageDoc | null {
  const projectId = useImage((s) => s.projectId)
  const current = useImage((s) => s.doc)
  const [doc, setDoc] = useState<ImageDoc | null>(null)
  useEffect(() => {
    if (!versionId || !projectId) return setDoc(null)
    if (versionId === 'atual') return setDoc(current)
    let alive = true
    api.image.versionDoc(projectId, versionId).then((d) => alive && setDoc(d)).catch(() => alive && setDoc(null))
    return () => {
      alive = false
    }
  }, [versionId, projectId, versionId === 'atual' ? current : null])
  return doc
}

function Compare() {
  const { compare, setCompare } = useImage()
  const versions = useStore((s) => s.versions)
  const a = useVersionDoc(compare?.a ?? null)
  const b = useVersionDoc(compare?.b ?? null)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (!compare) return null
  const options = [{ id: 'atual', label: 'Arte atual' }, ...[...versions].reverse().map((v) => ({ id: v.id, label: v.label }))]
  const pane = (doc: ImageDoc | null, key: 'a' | 'b') => {
    const scale = doc ? Math.min((size.w / 2 - 48) / doc.width, (size.h - 90) / doc.height) : 1
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
        <select value={compare[key]} onChange={(e) => setCompare({ ...compare, [key]: e.target.value })} className="h-7 rounded-md border border-line-2 bg-bg px-2 text-xs">
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {doc ? <DocCanvas doc={doc} scale={Math.max(0.05, scale)} className="shadow-2xl shadow-black/60" /> : <p className="text-xs text-faint">Carregando…</p>}
      </div>
    )
  }
  return (
    <div ref={box} className="relative flex min-h-0 flex-1 gap-4 overflow-hidden bg-[#0b0b10] p-4">
      {pane(a, 'a')}
      <div className="w-px bg-line" />
      {pane(b, 'b')}
      <IconButton title="Fechar comparação" className="absolute right-3 top-3" onClick={() => setCompare(null)}><X className="h-4 w-4" /></IconButton>
    </div>
  )
}

function VersionsStrip() {
  const versions = useStore((s) => s.versions)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const { viewVersionId, setViewVersion, projectId } = useImage()
  if (!versions.length) {
    return <div className="flex h-[74px] shrink-0 items-center justify-center border-t border-line bg-panel text-[11px] text-faint">As versões aparecem aqui (V1, V2…) a cada pedido ao Claude, geração ou "Salvar versão".</div>
  }
  return (
    <div className="flex h-[74px] shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-panel px-2">
      <button type="button" onClick={() => setViewVersion(null)}
        className={cx('flex h-14 shrink-0 flex-col items-center justify-center rounded-md border px-3 text-[11px]', !viewVersionId ? 'border-accent text-accent' : 'border-line-2 text-muted hover:text-fg')}>
        <span className="font-semibold">Atual</span><span className="text-[10px] text-faint">editando</span>
      </button>
      {[...versions].reverse().map((v) => (
        <button key={v.id} type="button" onClick={() => setViewVersion(v.id)} title={`${v.label} — ${v.request || ''}`}
          className={cx('group relative flex h-14 shrink-0 items-center gap-2 rounded-md border pr-2', viewVersionId === v.id ? 'border-accent' : 'border-line-2 hover:border-line-2 hover:bg-raised')}>
          <div className="h-full w-12 overflow-hidden rounded-l-md bg-bg">
            {v.thumbnail ? <img src={mediaUrl(v.thumbnail)} className="h-full w-full object-cover" alt="" /> : <div className="flex h-full items-center justify-center text-[9px] text-faint">…</div>}
          </div>
          <div className="text-left">
            <p className="text-[12px] font-semibold">{v.label}{project?.currentVersionId === v.id ? <span className="ml-1 text-[9.5px] font-normal text-accent">atual</span> : null}</p>
            <p className="max-w-[120px] truncate text-[10px] text-faint">{v.request || fmtAgo(v.createdAt)}</p>
          </div>
        </button>
      ))}
      {projectId && <span className="ml-auto shrink-0 px-2 text-[10px] text-faint">Clique numa versão para ver · restaurar não apaga nada</span>}
    </div>
  )
}

export function CenterPanel({ onExport, onVideo }: { onExport(): void; onVideo(): void }) {
  const { doc, viewVersionId, setViewVersion, compare, projectId, reloadFromDisk } = useImage()
  const versions = useStore((s) => s.versions)
  const { toast, loadProjects, refreshVersions } = useStore()
  const viewDoc = useVersionDoc(viewVersionId)
  const running = useStore((s) => (projectId ? Boolean(s.live[projectId]?.running) : false))
  if (!doc) return null
  const viewing = viewVersionId ? versions.find((v) => v.id === viewVersionId) : null

  const restore = async (): Promise<void> => {
    if (!projectId || !viewVersionId) return
    await useImage.getState().flush()
    await api.image.restoreVersion(projectId, viewVersionId)
    await reloadFromDisk()
    await refreshVersions()
    loadProjects()
    toast(`${viewing?.label} restaurada — as outras versões continuam salvas.`, 'ok')
  }

  return (
    <section className="flex h-full min-w-0 flex-col">
      <Toolbar onExport={onExport} onVideo={onVideo} />
      {running && (
        <div className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" />O Claude está editando a arte — a edição manual volta quando ele terminar.
        </div>
      )}
      {viewing && (
        <div className="flex shrink-0 items-center gap-2 border-b border-info/30 bg-info/10 px-3 py-1.5 text-[11.5px] text-info">
          <span className="min-w-0 flex-1 truncate">Visualizando <strong>{viewing.label}</strong>{viewing.request ? ` — "${viewing.request.slice(0, 80)}"` : ''}</span>
          <Button size="sm" variant="primary" onClick={restore}><RotateCcw className="h-3.5 w-3.5" />Restaurar esta versão</Button>
          <Button size="sm" variant="ghost" onClick={() => setViewVersion(null)}>Voltar à arte atual</Button>
        </div>
      )}
      {compare ? <Compare /> : viewDoc && viewing ? <CanvasView doc={viewDoc} readOnly /> : <CanvasView doc={doc} readOnly={running} />}
      <VersionsStrip />
    </section>
  )
}
