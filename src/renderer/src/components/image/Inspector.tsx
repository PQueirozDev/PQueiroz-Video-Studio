import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  Copy, Eye, EyeOff, Lock, Scissors, Trash2, Unlock
} from 'lucide-react'
import type { EffectLayer, ImageLayer, Layer, LayerRole, ShapeLayer, TextLayer } from '@shared/image'
import { safeAreaFor } from '@shared/image'
import { SYSTEM_FONTS, BUNDLED_FONTS } from '@shared/fonts'
import { api, cx } from '@/lib/format'
import { useStore } from '@/store'
import { useImage } from '@/image/imageStore'
import { blobBytes, fontFiles, registerFonts, removeFlatBackground } from '@/image/render'
import { IconButton } from '../ui'
import { ColorInput, FillEditor, Num, Row, Section, ShadowEditor, Slider, smallInput, StrokeEditor } from './controls'

const ROLES: { value: LayerRole; label: string }[] = [
  { value: 'background', label: 'Fundo' }, { value: 'subject', label: 'Herói (mascote/produto)' }, { value: 'logo', label: 'Logo' },
  { value: 'text', label: 'Texto' }, { value: 'decor', label: 'Decoração' }
]

function useFonts(brandFonts: string[]): { family: string; weights: number[] }[] {
  const [, force] = useState(0)
  useEffect(() => {
    registerFonts().then(() => force((n) => n + 1))
  }, [])
  return useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const f of fontFiles) map.set(f.family, (map.get(f.family) ?? new Set()).add(f.weight))
    for (const b of BUNDLED_FONTS) if (!map.has(b)) map.set(b, new Set([400]))
    for (const s of SYSTEM_FONTS) if (!map.has(s)) map.set(s, new Set([400, 700]))
    const list = [...map].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) }))
    // Fontes da marca primeiro.
    return list.sort((a, b) => Number(brandFonts.includes(b.family)) - Number(brandFonts.includes(a.family)) || a.family.localeCompare(b.family))
  }, [fontFiles.length, brandFonts.join()])
}

function TextProps({ l, set, palette, fonts }: { l: TextLayer; set(p: Partial<TextLayer>): void; palette: string[]; fonts: { family: string; weights: number[] }[] }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const checkpoint = useImage((s) => s.checkpoint)
  useEffect(() => {
    const onEdit = (e: Event): void => {
      if ((e as CustomEvent).detail === l.id) {
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('pq-edit-text', onEdit)
    return () => window.removeEventListener('pq-edit-text', onEdit)
  }, [l.id])
  const weights = fonts.find((f) => f.family === l.font)?.weights ?? [400, 700]
  return (
    <>
      <Section title="Texto">
        <textarea ref={ref} value={l.text} rows={Math.min(6, Math.max(2, l.text.split('\n').length))} onFocus={checkpoint}
          onChange={(e) => set({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 30) || 'Texto' })}
          className="w-full resize-none rounded-md border border-line-2 bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent" spellCheck lang="pt-BR" />
        <Row label="Fonte">
          <select className={smallInput} value={l.font} onFocus={checkpoint} onChange={(e) => {
            const w = fonts.find((f) => f.family === e.target.value)?.weights ?? [400]
            set({ font: e.target.value, weight: w.includes(l.weight) ? l.weight : w.reduce((a, b) => (Math.abs(b - l.weight) < Math.abs(a - l.weight) ? b : a)) })
          }}>
            {!fonts.some((f) => f.family === l.font) && <option value={l.font}>{l.font}</option>}
            {fonts.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.family}</option>)}
          </select>
        </Row>
        <Row label="Peso">
          <select className={smallInput} value={l.weight} onFocus={checkpoint} onChange={(e) => set({ weight: Number(e.target.value) })}>
            {[...new Set([...weights, l.weight])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <button type="button" title="Itálico" onClick={() => { checkpoint(); set({ italic: !l.italic }) }} className={cx('h-7 w-8 shrink-0 rounded-md border text-xs italic', l.italic ? 'border-accent text-accent' : 'border-line-2 text-muted')}>I</button>
          <button type="button" title="Caixa alta" onClick={() => { checkpoint(); set({ uppercase: !l.uppercase }) }} className={cx('h-7 w-8 shrink-0 rounded-md border text-[10px]', l.uppercase ? 'border-accent text-accent' : 'border-line-2 text-muted')}>AA</button>
        </Row>
        <Row label="Tamanho"><Num value={l.size} min={4} max={1200} onChange={(size) => set({ size })} suffix="px" /></Row>
        <Row label="Alinhar">
          <div className="flex w-full rounded-md border border-line-2 bg-bg p-0.5">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} type="button" onClick={() => { checkpoint(); set({ align: a }) }} className={cx('h-6 flex-1 rounded text-[11px]', l.align === a ? 'bg-raised text-fg' : 'text-muted')}>
                {a === 'left' ? 'Esq.' : a === 'center' ? 'Centro' : 'Dir.'}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Vertical">
          <div className="flex w-full rounded-md border border-line-2 bg-bg p-0.5">
            {(['top', 'middle', 'bottom'] as const).map((a) => (
              <button key={a} type="button" onClick={() => { checkpoint(); set({ vAlign: a }) }} className={cx('h-6 flex-1 rounded text-[11px]', l.vAlign === a ? 'bg-raised text-fg' : 'text-muted')}>
                {a === 'top' ? 'Topo' : a === 'middle' ? 'Meio' : 'Base'}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Entrelinha"><Slider min={0.7} max={2} value={l.lineHeight} onChange={(lineHeight) => set({ lineHeight })} /><span className="w-8 text-right text-[10.5px] text-faint">{l.lineHeight.toFixed(2)}</span></Row>
        <Row label="Espaçamento"><Slider min={-10} max={60} step={0.5} value={l.letterSpacing} onChange={(letterSpacing) => set({ letterSpacing })} /><span className="w-8 text-right text-[10.5px] text-faint">{l.letterSpacing}</span></Row>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={l.autoFit} onChange={(e) => { checkpoint(); set({ autoFit: e.target.checked }) }} />
          Reduzir fonte para caber na caixa
        </label>
      </Section>
      <Section title="Cor do texto"><FillEditor fill={l.fill} palette={palette} onChange={(fill) => set({ fill })} /></Section>
      <StrokeEditor stroke={l.stroke} onChange={(stroke) => set({ stroke })} title="Contorno" />
      <Section title="Faixa atrás do texto" right={
        <input type="checkbox" checked={Boolean(l.background)} onChange={(e) => {
          checkpoint()
          set({ background: e.target.checked ? { fill: { type: 'solid', color: palette[0] ?? '#000000' }, padding: Math.round(l.size * 0.3), radius: Math.round(l.size * 0.3) } : null })
        }} />
      }>
        {l.background && (
          <>
            <FillEditor fill={l.background.fill} palette={palette} onChange={(fill) => set({ background: { ...l.background!, fill } })} />
            <Row label="Respiro"><Slider min={0} max={160} step={1} value={l.background.padding} onChange={(padding) => set({ background: { ...l.background!, padding } })} /></Row>
            <Row label="Cantos"><Slider min={0} max={200} step={1} value={l.background.radius} onChange={(radius) => set({ background: { ...l.background!, radius } })} /></Row>
          </>
        )}
      </Section>
    </>
  )
}

function ImageProps({ l, set }: { l: ImageLayer; set(p: Partial<ImageLayer>): void }) {
  const { projectId, brands, info, checkpoint, doc } = useImage()
  const toast = useStore((s) => s.toast)
  const [cutting, setCutting] = useState(false)
  const brand = brands.find((b) => b.id === info?.brandId)
  const isLogo = l.role === 'logo'

  const cutout = async (): Promise<void> => {
    if (!projectId) return
    setCutting(true)
    try {
      const blob = await removeFlatBackground(l.src)
      const path = await api.image.saveAsset(projectId, await blobBytes(blob), `${l.name || 'imagem'} recortada`)
      checkpoint()
      set({ src: path, name: `${l.name} (recortada)` })
      toast('Fundo removido — o arquivo original foi mantido.', 'ok')
    } catch (err) {
      toast(String((err as Error).message), 'bad')
    } finally {
      setCutting(false)
    }
  }

  return (
    <>
      {isLogo && brand && (
        <Section title="Logo oficial">
          <p className="text-[11px] leading-snug text-faint">A logo nunca é redesenhada, recolorida ou distorcida. Escolha a versão:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {brand.logos.map((logo) => (
              <button key={logo.id} type="button" title={logo.name}
                onClick={() => {
                  if (!logo.width || !logo.height) return
                  checkpoint()
                  // Mantém a altura e o centro; a largura segue a proporção do arquivo.
                  const h = l.h, w = (h * logo.width) / logo.height
                  set({ src: logo.path, logoId: logo.id, name: logo.name, w: Math.round(w), x: Math.round(l.x + l.w / 2 - w / 2) })
                }}
                className={cx('flex h-14 items-center justify-center rounded-md border p-1.5', l.logoId === logo.id ? 'border-accent' : 'border-line-2', logo.variant === 'branca' ? 'bg-[#cd6d1e]' : 'bg-white')}>
                <img src={api.app.toMediaUrl(logo.path)} className="max-h-full max-w-full object-contain" alt={logo.name} />
              </button>
            ))}
          </div>
        </Section>
      )}
      {!isLogo && (
        <Section title="Imagem">
          <Row label="Ajuste">
            <select className={smallInput} value={l.fit} onFocus={checkpoint} onChange={(e) => set({ fit: e.target.value as ImageLayer['fit'] })}>
              <option value="contain">Inteira (sem cortar)</option>
              <option value="cover">Preencher (recorte inteligente)</option>
              <option value="fill">Esticar</option>
            </select>
          </Row>
          {l.fit === 'cover' && (
            <>
              <Row label="Foco ↔"><Slider min={0} max={1} value={l.focusX} onChange={(focusX) => set({ focusX })} /></Row>
              <Row label="Foco ↕"><Slider min={0} max={1} value={l.focusY} onChange={(focusY) => set({ focusY })} /></Row>
            </>
          )}
          <Row label="Cantos"><Slider min={0} max={400} step={1} value={l.radius} onChange={(radius) => set({ radius })} /></Row>
          <Row label="Brilho"><Slider min={0.3} max={1.8} value={l.brightness} onChange={(brightness) => set({ brightness })} /></Row>
          <Row label="Contraste"><Slider min={0.5} max={1.8} value={l.contrast} onChange={(contrast) => set({ contrast })} /></Row>
          <Row label="Saturação"><Slider min={0} max={2} value={l.saturation} onChange={(saturation) => set({ saturation })} /></Row>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button type="button" onClick={() => { checkpoint(); set({ flipX: !l.flipX }) }} className="h-7 rounded-md border border-line-2 px-2 text-[11px] text-muted hover:text-fg">Espelhar</button>
            {doc && <button type="button" onClick={() => { checkpoint(); set({ x: 0, y: 0, w: doc.width, h: doc.height, fit: 'cover', rotation: 0 }) }} className="h-7 rounded-md border border-line-2 px-2 text-[11px] text-muted hover:text-fg">Preencher arte</button>}
            <button type="button" disabled={cutting} onClick={cutout} title="Remove fundo liso (ex.: mascote gerado sobre branco). Cria um arquivo novo."
              className="flex h-7 items-center gap-1 rounded-md border border-line-2 px-2 text-[11px] text-muted hover:text-fg disabled:opacity-50">
              <Scissors className="h-3 w-3" />{cutting ? 'Recortando…' : 'Remover fundo'}
            </button>
          </div>
        </Section>
      )}
      {!isLogo && <StrokeEditor stroke={l.stroke} onChange={(stroke) => set({ stroke })} />}
    </>
  )
}

function ShapeProps({ l, set, palette }: { l: ShapeLayer; set(p: Partial<ShapeLayer>): void; palette: string[] }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <>
      <Section title="Forma">
        <Row label="Tipo">
          <select className={smallInput} value={l.shape} onFocus={checkpoint} onChange={(e) => set({ shape: e.target.value as ShapeLayer['shape'] })}>
            <option value="rect">Retângulo</option><option value="ellipse">Elipse</option><option value="burst">Selo / explosão</option>
            <option value="triangle">Triângulo</option><option value="line">Linha / barra</option><option value="blob">Orgânica</option>
          </select>
        </Row>
        {l.shape === 'rect' && <Row label="Cantos"><Slider min={0} max={Math.min(l.w, l.h) / 2} step={1} value={l.radius} onChange={(radius) => set({ radius })} /></Row>}
        {l.shape === 'burst' && (
          <>
            <Row label="Pontas"><Slider min={5} max={40} step={1} value={l.points} onChange={(points) => set({ points })} /></Row>
            <Row label="Profundidade"><Slider min={0.3} max={0.95} value={l.innerRatio} onChange={(innerRatio) => set({ innerRatio })} /></Row>
          </>
        )}
      </Section>
      <Section title="Preenchimento"><FillEditor fill={l.fill} palette={palette} onChange={(fill) => set({ fill })} /></Section>
      <StrokeEditor stroke={l.stroke} onChange={(stroke) => set({ stroke })} />
    </>
  )
}

function EffectProps({ l, set, palette }: { l: EffectLayer; set(p: Partial<EffectLayer>): void; palette: string[] }) {
  const checkpoint = useImage((s) => s.checkpoint)
  return (
    <Section title="Efeito">
      <Row label="Tipo">
        <select className={smallInput} value={l.effect} onFocus={checkpoint} onChange={(e) => set({ effect: e.target.value as EffectLayer['effect'] })}>
          <option value="rays">Raios de luz</option><option value="glow">Brilho / luz</option><option value="bokeh">Bokeh</option>
          <option value="confetti">Confete</option><option value="sparkles">Brilhos</option><option value="vignette">Vinheta</option><option value="grain">Granulado</option>
        </select>
      </Row>
      <Row label="Intensidade"><Slider min={0} max={1} value={l.density} onChange={(density) => set({ density })} /></Row>
      {l.colors.map((c, i) => (
        <Row key={i} label={`Cor ${i + 1}`}><ColorInput value={c} palette={palette} onChange={(v) => set({ colors: l.colors.map((x, k) => (k === i ? v : x)) })} /></Row>
      ))}
      <div className="flex gap-1.5">
        {l.colors.length < 5 && <button type="button" onClick={() => { checkpoint(); set({ colors: [...l.colors, palette[l.colors.length % Math.max(1, palette.length)] ?? '#ffffff'] }) }} className="h-7 rounded-md border border-line-2 px-2 text-[11px] text-muted hover:text-fg">+ Cor</button>}
        <button type="button" onClick={() => { checkpoint(); set({ seed: Math.floor(Math.random() * 99999) }) }} className="h-7 rounded-md border border-line-2 px-2 text-[11px] text-muted hover:text-fg">Sortear posições</button>
      </div>
    </Section>
  )
}

export function Inspector() {
  const { doc, selectedId, updateLayer, mutate, checkpoint, removeLayer, duplicateLayer, brands, info } = useImage()
  const layer = doc?.layers.find((l) => l.id === selectedId)
  const brand = brands.find((b) => b.id === info?.brandId)
  const palette = brand?.colors.map((c) => c.hex) ?? ['#ffffff', '#000000', '#8b5cf6', '#f472b6', '#fbbf24']
  const fonts = useFonts(brand ? [brand.fonts.heading, brand.fonts.body] : [])
  if (!doc || !layer) return null
  // Mudanças contínuas: o ponto de desfazer já foi registrado no foco/clique do controle.
  const set = (p: Partial<Layer>): void => mutate((d) => ({ ...d, layers: d.layers.map((l) => (l.id === layer.id ? ({ ...l, ...p } as Layer) : l)) }))
  const safe = safeAreaFor(doc)
  const align = (kind: 'l' | 'c' | 'r' | 't' | 'm' | 'b'): void => {
    const x = kind === 'l' ? safe.left : kind === 'c' ? (doc.width - layer.w) / 2 : kind === 'r' ? doc.width - safe.right - layer.w : layer.x
    const y = kind === 't' ? safe.top : kind === 'm' ? (doc.height - layer.h) / 2 : kind === 'b' ? doc.height - safe.bottom - layer.h : layer.y
    updateLayer(layer.id, { x: Math.round(x), y: Math.round(y) })
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <input className={cx(smallInput, 'h-7 flex-1 font-medium')} value={layer.name} onFocus={checkpoint} onChange={(e) => set({ name: e.target.value })} />
        <IconButton title={layer.visible ? 'Ocultar' : 'Mostrar'} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</IconButton>
        <IconButton title={layer.locked ? 'Destravar' : 'Travar posição'} onClick={() => updateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</IconButton>
        <IconButton title="Duplicar (Ctrl+D)" onClick={() => duplicateLayer(layer.id)}><Copy className="h-3.5 w-3.5" /></IconButton>
        <IconButton title="Excluir (Delete)" onClick={() => removeLayer(layer.id)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
      </div>

      <Section title="Posição e tamanho">
        <div className="grid grid-cols-2 gap-1.5">
          <Row label="X" className="[&>span]:w-4"><Num value={layer.x} onChange={(x) => set({ x })} /></Row>
          <Row label="Y" className="[&>span]:w-4"><Num value={layer.y} onChange={(y) => set({ y })} /></Row>
          <Row label="L" className="[&>span]:w-4"><Num value={layer.w} min={1} onChange={(w) => set(layer.type === 'image' ? { w, h: Math.round((w * layer.h) / layer.w) } : { w })} /></Row>
          <Row label="A" className="[&>span]:w-4"><Num value={layer.h} min={1} onChange={(h) => set(layer.type === 'image' ? { h, w: Math.round((h * layer.w) / layer.h) } : { h })} /></Row>
        </div>
        {layer.role !== 'logo' && <Row label="Rotação"><Slider min={-180} max={180} step={1} value={layer.rotation} onChange={(rotation) => set({ rotation })} /><span className="w-8 text-right text-[10.5px] text-faint">{Math.round(layer.rotation)}°</span></Row>}
        <Row label="Opacidade"><Slider min={0} max={1} value={layer.opacity} onChange={(opacity) => set({ opacity })} /><span className="w-8 text-right text-[10.5px] text-faint">{Math.round(layer.opacity * 100)}%</span></Row>
        <div className="flex items-center gap-0.5">
          <span className="w-20 shrink-0 text-[11px] text-faint">Alinhar</span>
          <IconButton title="À esquerda (área segura)" onClick={() => align('l')}><AlignStartVertical className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Centro horizontal" onClick={() => align('c')}><AlignCenterVertical className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="À direita (área segura)" onClick={() => align('r')}><AlignEndVertical className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Ao topo (área segura)" onClick={() => align('t')}><AlignStartHorizontal className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Centro vertical" onClick={() => align('m')}><AlignCenterHorizontal className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="À base (área segura)" onClick={() => align('b')}><AlignEndHorizontal className="h-3.5 w-3.5" /></IconButton>
        </div>
        <Row label="Papel">
          <select className={smallInput} value={layer.role} onFocus={checkpoint} onChange={(e) => set({ role: e.target.value as LayerRole })}>
            {ROLES.filter((r) => layer.type === 'image' || r.value !== 'logo').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Row>
        <Row label="Mesclagem">
          <select className={smallInput} value={layer.blend} onFocus={checkpoint} onChange={(e) => set({ blend: e.target.value as Layer['blend'] })}>
            <option value="normal">Normal</option><option value="multiply">Multiplicar</option><option value="screen">Tela (clarear)</option>
            <option value="overlay">Sobrepor</option><option value="soft-light">Luz suave</option><option value="lighter">Somar luz</option>
          </select>
        </Row>
      </Section>

      {layer.type === 'text' && <TextProps l={layer} set={set} palette={palette} fonts={fonts} />}
      {layer.type === 'image' && <ImageProps l={layer} set={set} />}
      {layer.type === 'shape' && <ShapeProps l={layer} set={set} palette={palette} />}
      {layer.type === 'effect' && <EffectProps l={layer} set={set} palette={palette} />}
      {layer.type !== 'effect' && <ShadowEditor shadow={layer.shadow} onChange={(shadow) => set({ shadow })} />}
    </div>
  )
}
