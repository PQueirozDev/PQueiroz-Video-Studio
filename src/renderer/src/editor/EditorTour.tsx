import { useEffect, useLayoutEffect, useState } from 'react'
import { Button, Dialog } from '@/components/ui'

// Tour do editor (primeira vez) e janela de atalhos. Cada passo destaca um elemento marcado com data-tour.

const DONE_KEY = 'pq-editor-tour-v1'

interface Step { target: string; title: string; text: string }

const STEPS: Step[] = [
  { target: 'browser', title: 'Recursos', text: 'Mídias do projeto, transições, efeitos, LUTs e o Asset Hub: títulos, sons, overlays e presets. Arraste para a timeline ou clique para aplicar no clipe selecionado.' },
  { target: 'timeline', title: 'Timeline', text: 'Arraste clipes, puxe as bordas para cortar (Alt+arrastar = slip), S divide no playhead, Ctrl+G agrupa, Ctrl+Z desfaz. Tudo é não destrutivo.' },
  { target: 'inspector', title: 'Inspetor', text: 'Ajustes do clipe selecionado: enquadramento, keyframes (losango), velocidade, efeitos, curvas e máscara. Sem seleção, mostra cliente, estilo e mixagem do projeto.' },
  { target: 'auto', title: 'Auto Studio', text: 'Escolha vídeos, música e estilo: o app analisa tudo e monta a edição sozinho, com cortes na batida. Um Ctrl+Z desfaz.' },
  { target: 'exact', title: 'Prévia exata e antes/depois', text: 'O player mostra uma prévia rápida. Para ver efeitos, LUTs e mixagem exatamente como no export, use a Prévia exata (ou compare antes/depois).' },
  { target: 'qc', title: 'Quality Check', text: 'Antes de entregar: tela preta, texto fora da área segura do destino, volume, piscadas. Muitos itens têm o botão Corrigir.' },
  { target: 'chat', title: 'Claude', text: 'Peça em português ("legenda tudo em amarelo", "faz um shorts com as melhores jogadas"): o Claude edita esta mesma timeline com as ferramentas do estúdio.' }
]

export const SHORTCUTS: [string, string][] = [
  ['Espaço', 'Reproduzir / pausar'], ['S', 'Dividir no playhead'], ['Delete', 'Excluir seleção (Shift: fecha o espaço)'],
  ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'], ['Ctrl+C / Ctrl+V', 'Copiar / colar efeitos e animações'], ['Ctrl+G / Ctrl+Shift+G', 'Agrupar / desagrupar'],
  ['Ctrl+A', 'Selecionar tudo'], ['Alt+arrastar', 'Slip (troca o trecho sem mover)'], ['M', 'Marcador no playhead'],
  ['← / →', 'Um quadro (Shift: um segundo)'], ['Home / End', 'Início / fim'], ['+ / -', 'Zoom da timeline'], ['Ctrl+roda', 'Zoom no ponto do mouse'],
  ['Ctrl+K', 'Paleta de comandos'], ['?', 'Esta lista']
]

function readDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}
function markDone(): void {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* sem armazenamento: o tour volta na próxima vez */ }
}

export function EditorTour() {
  const [step, setStep] = useState<number | null>(null)
  const [box, setBox] = useState<DOMRect | null>(null)
  const [keys, setKeys] = useState(false)

  useEffect(() => {
    // Abre sozinho na primeira vez; depois, pela paleta de comandos (eventos abaixo).
    const t = window.setTimeout(() => { if (!readDone()) setStep(0) }, 800)
    const tour = (): void => setStep(0)
    const shortcuts = (): void => setKeys(true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '?' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) setKeys(true)
    }
    window.addEventListener('pq-editor-tour', tour)
    window.addEventListener('pq-shortcuts', shortcuts)
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(t); window.removeEventListener('pq-editor-tour', tour); window.removeEventListener('pq-shortcuts', shortcuts); window.removeEventListener('keydown', onKey) }
  }, [])

  useLayoutEffect(() => {
    if (step === null) return
    const measure = (): void => setBox(document.querySelector(`[data-tour="${STEPS[step].target}"]`)?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step])

  const close = (): void => { markDone(); setStep(null) }
  const s = step !== null ? STEPS[step] : null
  // Balão ao lado do elemento, dentro da janela.
  const pos = (() => {
    if (!box) return { left: window.innerWidth / 2 - 170, top: window.innerHeight / 2 - 80 }
    const w = 340
    const right = box.right + 12 + w < window.innerWidth
    const left = right ? box.right + 12 : Math.max(12, box.left - w - 12)
    const fitsSide = right || box.left - w - 12 > 0
    return fitsSide ? { left, top: Math.min(window.innerHeight - 200, Math.max(12, box.top + 8)) } : { left: Math.min(window.innerWidth - w - 12, Math.max(12, box.left)), top: Math.max(12, box.top - 190) }
  })()

  return (
    <>
      {s && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-label={`Tour: ${s.title}`}>
          {/* Recorte em volta do elemento destacado (o resto escurece). */}
          <div className="pointer-events-none absolute rounded-lg ring-2 ring-accent transition-all duration-200"
            style={box ? { left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8, boxShadow: '0 0 0 9999px rgba(0,0,0,.6)' } : { inset: 0, boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,.6)' }} />
          <div className="absolute w-[340px] rounded-xl border border-line-2 bg-panel p-4 shadow-2xl shadow-black/60" style={pos}>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">{step! + 1} de {STEPS.length}</p>
            <h3 className="mt-1 text-[14px] font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{s.text}</p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="mr-auto text-[11.5px] text-faint hover:text-fg" onClick={close}>Pular tour</button>
              {step! > 0 && <Button size="sm" variant="ghost" onClick={() => setStep(step! - 1)}>Voltar</Button>}
              <Button size="sm" variant="primary" onClick={() => (step! + 1 < STEPS.length ? setStep(step! + 1) : close())}>{step! + 1 < STEPS.length ? 'Próximo' : 'Começar a editar'}</Button>
            </div>
          </div>
        </div>
      )}
      <Dialog open={keys} onClose={() => setKeys(false)} title="Atalhos do teclado" width={480}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt><kbd className="rounded border border-line-2 bg-bg px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  )
}
