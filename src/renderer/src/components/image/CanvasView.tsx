import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react'
import type { ImageDoc, Layer, TextLayer } from '@shared/image'
import { safeAreaFor } from '@shared/image'
import { imageLayer } from '@shared/imageDoc'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { drawDoc, prepare } from '@/image/render'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rot'
const HANDLES: { id: Handle; sx: number; sy: number }[] = [
  { id: 'nw', sx: -1, sy: -1 }, { id: 'n', sx: 0, sy: -1 }, { id: 'ne', sx: 1, sy: -1 }, { id: 'e', sx: 1, sy: 0 },
  { id: 'se', sx: 1, sy: 1 }, { id: 's', sx: 0, sy: 1 }, { id: 'sw', sx: -1, sy: 1 }, { id: 'w', sx: -1, sy: 0 }
]

interface Drag {
  kind: 'move' | Handle
  id: string
  start: { x: number; y: number }
  box: { x: number; y: number; w: number; h: number; rotation: number; size?: number }
}

interface Guide { axis: 'x' | 'y'; at: number }

/** Desenha um documento num <canvas> com a escala pedida (usado também na comparação de versões). */
export function DocCanvas({ doc, scale, className }: { doc: ImageDoc; scale: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    const dpr = window.devicePixelRatio || 1
    prepare(doc).then((loaded) => {
      const c = ref.current
      if (!alive || !c) return
      c.width = Math.max(1, Math.round(doc.width * scale * dpr))
      c.height = Math.max(1, Math.round(doc.height * scale * dpr))
      drawDoc(c.getContext('2d')!, doc, loaded, { scale: scale * dpr })
    })
    return () => {
      alive = false
    }
  }, [doc, scale])
  return <canvas ref={ref} className={className} style={{ width: doc.width * scale, height: doc.height * scale }} />
}

const isTyping = (): boolean => {
  const el = document.activeElement as HTMLElement | null
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable))
}

function hitTest(doc: ImageDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i]
    if (!l.visible || l.type === 'effect' || l.role === 'background') continue
    const cx0 = l.x + l.w / 2, cy0 = l.y + l.h / 2
    const a = (-l.rotation * Math.PI) / 180
    const dx = x - cx0, dy = y - cy0
    const lx = dx * Math.cos(a) - dy * Math.sin(a)
    const ly = dx * Math.sin(a) + dy * Math.cos(a)
    if (Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2) return l
  }
  return null
}

export function CanvasView({ doc, readOnly = false }: { doc: ImageDoc; readOnly?: boolean }) {
  const { zoom, selectedId, select, checkpoint, mutate, showSafe, showGrid, setZoom, info } = useImage()
  const projectId = useImage((s) => s.projectId)
  const toast = useStore((s) => s.toast)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [fitZoom, setFitZoom] = useState(0.4)
  const [guides, setGuides] = useState<Guide[]>([])
  const drag = useRef<Drag | null>(null)
  const z = zoom === 'fit' ? fitZoom : zoom
  const selected = readOnly ? null : doc.layers.find((l) => l.id === selectedId) ?? null

  // Zoom "ajustar": cabe na área visível.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = (): void => setFitZoom(Math.max(0.05, Math.min((el.clientWidth - 56) / doc.width, (el.clientHeight - 56) / doc.height)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc.width, doc.height])

  // Redesenho (um quadro por vez durante arrastos).
  useEffect(() => {
    let alive = true
    let raf = 0
    prepare(doc).then((loaded) => {
      raf = requestAnimationFrame(() => {
        const c = canvas.current
        if (!alive || !c) return
        const dpr = window.devicePixelRatio || 1
        const w = Math.max(1, Math.round(doc.width * z * dpr)), h = Math.max(1, Math.round(doc.height * z * dpr))
        if (c.width !== w || c.height !== h) {
          c.width = w
          c.height = h
        }
        drawDoc(c.getContext('2d')!, doc, loaded, { scale: z * dpr })
      })
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [doc, z])

  const toDoc = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }
  }, [z])

  const snap = (l: Layer, x: number, y: number, threshold: number): { x: number; y: number; guides: Guide[] } => {
    const safe = safeAreaFor(doc)
    const xs = [0, doc.width / 2, doc.width, safe.left, doc.width - safe.right]
    const ys = [0, doc.height / 2, doc.height, safe.top, doc.height - safe.bottom]
    for (const o of doc.layers) {
      if (o.id === l.id || !o.visible || o.role === 'background' || o.type === 'effect') continue
      xs.push(o.x, o.x + o.w / 2, o.x + o.w)
      ys.push(o.y, o.y + o.h / 2, o.y + o.h)
    }
    const out: Guide[] = []
    const best = (pos: number[], targets: number[]): { d: number; at: number } | null => {
      let r: { d: number; at: number } | null = null
      for (const p of pos) for (const t of targets) {
        const d = t - p
        if (Math.abs(d) <= threshold && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, at: t }
      }
      return r
    }
    const bx = best([x, x + l.w / 2, x + l.w], xs)
    const by = best([y, y + l.h / 2, y + l.h], ys)
    if (bx) {
      x += bx.d
      out.push({ axis: 'x', at: bx.at })
    }
    if (by) {
      y += by.d
      out.push({ axis: 'y', at: by.at })
    }
    return { x, y, guides: out }
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>, handle?: Handle): void => {
    if (readOnly || e.button !== 0) return
    e.stopPropagation()
    const p = toDoc(e)
    let target = handle && selected ? selected : hitTest(doc, p.x, p.y)
    if (!handle) select(target?.id ?? null)
    if (!target || target.locked) return
    if (handle && selected) target = selected
    checkpoint()
    drag.current = {
      kind: handle ?? 'move', id: target.id, start: p,
      box: { x: target.x, y: target.y, w: target.w, h: target.h, rotation: target.rotation, size: target.type === 'text' ? target.size : undefined }
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const l = doc.layers.find((x) => x.id === d.id)
    if (!l) return
    const p = toDoc(e)
    const dx = p.x - d.start.x, dy = p.y - d.start.y
    const b = d.box
    if (d.kind === 'move') {
      let x = b.x + dx, y = b.y + dy
      let g: Guide[] = []
      if (!e.altKey) {
        const s = snap({ ...l, x, y } as Layer, x, y, 7 / z)
        x = s.x
        y = s.y
        g = s.guides
      }
      setGuides(g)
      mutate((doc) => ({ ...doc, layers: doc.layers.map((o) => (o.id === d.id ? { ...o, x: Math.round(x), y: Math.round(y) } : o)) }))
      return
    }
    const cx0 = b.x + b.w / 2, cy0 = b.y + b.h / 2
    if (d.kind === 'rot') {
      let deg = (Math.atan2(p.y - cy0, p.x - cx0) * 180) / Math.PI + 90
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      else if (Math.abs(((deg % 90) + 90) % 90) < 3 || Math.abs(((deg % 90) + 90) % 90) > 87) deg = Math.round(deg / 90) * 90
      deg = ((deg + 540) % 360) - 180
      mutate((doc) => ({ ...doc, layers: doc.layers.map((o) => (o.id === d.id ? { ...o, rotation: Math.round(deg * 10) / 10 } : o)) }))
      return
    }
    const h = HANDLES.find((x) => x.id === d.kind)!
    const a = (b.rotation * Math.PI) / 180
    // Deslocamento no eixo da camada (funciona com camadas giradas).
    const lx = dx * Math.cos(-a) - dy * Math.sin(-a)
    const ly = dx * Math.sin(-a) + dy * Math.cos(-a)
    let w = Math.max(8, b.w + h.sx * lx)
    let hh = Math.max(8, b.h + h.sy * ly)
    // Logos e imagens nunca distorcem; textos escalam a fonte pelos cantos.
    const lockAspect = l.type === 'image' || e.shiftKey || (l.type === 'text' && h.sx !== 0 && h.sy !== 0)
    if (lockAspect) {
      const k = h.sx && h.sy ? Math.max(w / b.w, hh / b.h) : h.sx ? w / b.w : hh / b.h
      w = Math.max(8, b.w * k)
      hh = Math.max(8, b.h * k)
    }
    const shiftX = h.sx ? (h.sx * (w - b.w)) / 2 : 0
    const shiftY = h.sy ? (h.sy * (hh - b.h)) / 2 : 0
    const ncx = cx0 + shiftX * Math.cos(a) - shiftY * Math.sin(a)
    const ncy = cy0 + shiftX * Math.sin(a) + shiftY * Math.cos(a)
    const patch: Partial<Layer> = { x: Math.round(ncx - w / 2), y: Math.round(ncy - hh / 2), w: Math.round(w), h: Math.round(hh) }
    if (l.type === 'text' && b.size && h.sx && h.sy) (patch as Partial<TextLayer>).size = Math.max(6, Math.round(b.size * (w / b.w)))
    mutate((doc) => ({ ...doc, layers: doc.layers.map((o) => (o.id === d.id ? ({ ...o, ...patch } as Layer) : o)) }))
  }

  const onPointerUp = (): void => {
    drag.current = null
    setGuides([])
  }

  // Atalhos de teclado do editor.
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping()) return
      const s = useImage.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        s.redo()
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void s.saveVersion('Edição manual', 'Versão salva pelo Pedro')
      } else if (ctrl && e.key === '0') {
        e.preventDefault()
        s.setZoom('fit')
      } else if (ctrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        s.setZoom(Math.min(4, (s.zoom === 'fit' ? fitZoom : s.zoom) * 1.25))
      } else if (ctrl && e.key === '-') {
        e.preventDefault()
        s.setZoom(Math.max(0.05, (s.zoom === 'fit' ? fitZoom : s.zoom) / 1.25))
      } else if (s.selectedId && ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        s.duplicateLayer(s.selectedId)
      } else if (s.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        s.removeLayer(s.selectedId)
      } else if (e.key === 'Escape') s.select(null)
      else if (s.selectedId && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const l = s.doc?.layers.find((x) => x.id === s.selectedId)
        if (l && !l.locked) s.updateLayer(l.id, { x: l.x + dx, y: l.y + dy })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, fitZoom])

  const onWheel = (e: React.WheelEvent): void => {
    if (!e.ctrlKey) return
    e.preventDefault()
    setZoom(Math.min(4, Math.max(0.05, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))
  }

  const onDrop = async (e: DragEvent): Promise<void> => {
    if (readOnly || !projectId) return
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    const p = toDoc(e)
    const imported = await api.image.importImages(projectId, files.map((f) => api.media.pathForFile(f)).filter(Boolean))
    if (!imported.length) {
      toast('Solte imagens PNG, JPG ou WebP.', 'bad')
      return
    }
    for (const img of imported) {
      const w = Math.min(doc.width * 0.6, img.width)
      const h = (w * img.height) / img.width
      useImage.getState().addLayer(imageLayer(img.path, Math.round(p.x - w / 2), Math.round(p.y - h / 2), Math.round(w), Math.round(h), { name: img.path.split(/[\\/]/).pop() ?? 'Imagem' }))
    }
  }

  const safe = safeAreaFor(doc)
  const brandMargin = info?.brandId ? useImage.getState().brands.find((b) => b.id === info.brandId)?.logoMargin ?? 0 : 0

  return (
    <div
      ref={box}
      onWheel={onWheel}
      onPointerDown={() => !readOnly && select(null)}
      onDragOver={(e) => {
        if (!readOnly && Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={onDrop}
      className="relative flex min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_50%_40%,#17151f,#0b0b10)]"
    >
      <div className="relative m-auto shrink-0 p-7" style={{ width: doc.width * z + 56, height: doc.height * z + 56 }}>
        <div className="relative shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)] ring-1 ring-white/5" style={{ width: doc.width * z, height: doc.height * z }}>
          <canvas ref={canvas} className="block" style={{ width: doc.width * z, height: doc.height * z }} />
          <div
            className={cx('absolute inset-0', !readOnly && 'cursor-default')}
            onPointerDown={(e) => onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={(e) => {
              const l = hitTest(doc, toDoc(e).x, toDoc(e).y)
              if (l?.type === 'text') window.dispatchEvent(new CustomEvent('pq-edit-text', { detail: l.id }))
            }}
          >
            <svg className="pointer-events-none absolute inset-0 overflow-visible" width={doc.width * z} height={doc.height * z}>
              {showGrid && [1, 2].map((i) => (
                <g key={i} stroke="#ffffff22" strokeWidth={1}>
                  <line x1={(doc.width * z * i) / 3} y1={0} x2={(doc.width * z * i) / 3} y2={doc.height * z} />
                  <line x1={0} y1={(doc.height * z * i) / 3} x2={doc.width * z} y2={(doc.height * z * i) / 3} />
                </g>
              ))}
              {showSafe && !readOnly && (
                <rect x={safe.left * z} y={safe.top * z} width={(doc.width - safe.left - safe.right) * z} height={(doc.height - safe.top - safe.bottom) * z}
                  fill="none" stroke="#8b5cf6aa" strokeDasharray="6 5" strokeWidth={1} />
              )}
              {guides.map((g, i) => g.axis === 'x'
                ? <line key={i} x1={g.at * z} x2={g.at * z} y1={0} y2={doc.height * z} stroke="#f472b6" strokeWidth={1} />
                : <line key={i} y1={g.at * z} y2={g.at * z} x1={0} x2={doc.width * z} stroke="#f472b6" strokeWidth={1} />)}
              {selected?.role === 'logo' && brandMargin > 0 && (() => {
                const m = brandMargin * Math.min(doc.width, doc.height)
                return <rect x={(selected.x - m) * z} y={(selected.y - m) * z} width={(selected.w + 2 * m) * z} height={(selected.h + 2 * m) * z} fill="none" stroke="#fbbf2488" strokeDasharray="3 4" />
              })()}
            </svg>
            {selected && (
              <div
                className="absolute border border-accent"
                style={{
                  left: selected.x * z, top: selected.y * z, width: selected.w * z, height: selected.h * z,
                  transform: `rotate(${selected.rotation}deg)`, transformOrigin: 'center', boxShadow: '0 0 0 1px #0008'
                }}
              >
                {!selected.locked && HANDLES.map((h) => (
                  <div
                    key={h.id}
                    onPointerDown={(e) => onPointerDown(e, h.id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className="absolute h-2.5 w-2.5 rounded-[3px] border border-accent bg-white"
                    style={{ left: `calc(${(h.sx + 1) * 50}% - 5px)`, top: `calc(${(h.sy + 1) * 50}% - 5px)`, cursor: `${h.id === 'n' || h.id === 's' ? 'ns' : h.id === 'e' || h.id === 'w' ? 'ew' : h.id === 'ne' || h.id === 'sw' ? 'nesw' : 'nwse'}-resize` }}
                  />
                ))}
                {!selected.locked && selected.role !== 'logo' && (
                  <div
                    onPointerDown={(e) => onPointerDown(e, 'rot')}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    title="Girar (Shift = 15°)"
                    className="absolute left-1/2 -top-7 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-accent bg-white"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
