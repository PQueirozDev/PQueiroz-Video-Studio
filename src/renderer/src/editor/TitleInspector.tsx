import { useEffect, useMemo, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import type { Clip, TitleSpec } from '@shared/composition'
import { cx } from '@/lib/format'
import { Toggle } from '@/components/ui'
import { Section, Slider } from './controls'
import { useEditor } from './editorStore'
import { assetId, fontFamily, useHub } from './hub'

// Edição de um título: texto, fonte do Asset Hub, tamanho, cor, posição, contorno, sombra e caixa.

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit(v: string): void }) {
  return (
    <label className="flex h-7 items-center justify-between gap-2 text-[11px] text-muted">
      {label}
      <input type="color" value={value} onChange={(e) => onCommit(e.target.value)} aria-label={label} className="h-6 w-10 cursor-pointer rounded border border-line-2 bg-bg" />
    </label>
  )
}

export function TitleInspector({ clip }: { clip: Clip }) {
  const { edit } = useEditor()
  const items = useHub((s) => s.items)
  const fonts = useMemo(() => items.filter((i) => i.type === 'font'), [items])
  const load = useHub((s) => s.load)
  useEffect(() => void load(), [load])
  const t = clip.title!
  const [text, setText] = useState(t.text)
  useEffect(() => setText(t.text), [t.text])
  const set = (patch: Partial<TitleSpec>): void => void edit([{ type: 'updateTitle', clipId: clip.id, title: patch }])
  const commitText = (): void => { if (text !== t.text && text.trim()) set({ text }) }

  return (
    <Section title="Título">
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commitText} aria-label="Texto do título" rows={3} maxLength={500}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText() } }}
        className="mb-1.5 w-full resize-y rounded-md border border-line-2 bg-bg px-2 py-1.5 text-[12px] outline-none focus:border-accent" />
      <select aria-label="Fonte" value={t.font} onChange={(e) => set({ font: e.target.value })} className="mb-1.5 h-7 w-full rounded-md border border-line-2 bg-bg px-2 text-xs" style={{ fontFamily: `"${fontFamily(t.font)}"` }}>
        {fonts.map((f) => <option key={f.key} value={assetId(f)} style={{ fontFamily: `"${fontFamily(assetId(f))}"` }}>{f.name}</option>)}
        {!fonts.some((f) => assetId(f) === t.font) && <option value={t.font}>{t.font} (não instalada)</option>}
      </select>
      <div className="mb-1.5 flex gap-1">
        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
          <button key={a} type="button" aria-label={`Alinhar ${a}`} onClick={() => set({ align: a })}
            className={cx('flex h-7 flex-1 items-center justify-center rounded border', t.align === a ? 'border-accent bg-accent/20' : 'border-line text-faint hover:text-fg')}><Icon className="h-3.5 w-3.5" /></button>
        ))}
      </div>
      <Slider label="Tamanho" value={t.size} min={0.02} max={0.4} step={0.005} onCommit={(v) => set({ size: v })} />
      <ColorField label="Cor" value={t.color} onCommit={(v) => set({ color: v })} />
      <Slider label="Posição X" value={t.x} min={0} max={1} step={0.005} onCommit={(v) => set({ x: v })} />
      <Slider label="Posição Y" value={t.y} min={0} max={1} step={0.005} onCommit={(v) => set({ y: v })} />
      <Slider label="Espaço entre linhas" value={t.lineSpacing} min={0.8} max={2.5} step={0.05} onCommit={(v) => set({ lineSpacing: v })} />
      <Slider label="Contorno" value={t.outline} min={0} max={0.2} step={0.005} onCommit={(v) => set({ outline: v })} />
      {t.outline > 0 && <ColorField label="Cor do contorno" value={t.outlineColor} onCommit={(v) => set({ outlineColor: v })} />}
      <Slider label="Sombra" value={t.shadow} min={0} max={0.15} step={0.005} onCommit={(v) => set({ shadow: v })} />
      <Slider label="Caixa de fundo" value={t.box} min={0} max={1} step={0.05} onCommit={(v) => set({ box: v })} />
      {t.box > 0 && <ColorField label="Cor da caixa" value={t.boxColor} onCommit={(v) => set({ boxColor: v })} />}
      <Toggle checked={t.uppercase} onChange={(v) => set({ uppercase: v })} label="Tudo em maiúsculas" />
    </Section>
  )
}
