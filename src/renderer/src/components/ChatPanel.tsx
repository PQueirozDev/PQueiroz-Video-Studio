import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, CheckCircle2, ChevronDown, ChevronRight, ListChecks, RotateCcw, Square, Wand2 } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { api, cx } from '@/lib/format'
import { Markdown, splitBlocks } from '@/lib/markdown'
import { useStore } from '@/store'
import { Button, IconButton, Progress } from './ui'

const SUGGESTIONS = [
  'Analise os vídeos e proponha a edição no padrão Aquecedores Fortes.',
  'Tire os primeiros 3 segundos.',
  'A música ficou muito alta.',
  'Faça esse vídeo ficar mais dinâmico.',
  'Transforme em Reel 9:16.',
  'Volte para a versão anterior.'
]

const APPROVE = 'Plano aprovado. Pode executar a edição.'

function PlanCard({ steps, actionable, onRun }: { steps: string[]; actionable: boolean; onRun(): void }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-accent/30 bg-accent/[0.06]">
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2 text-xs font-semibold text-accent">
        <ListChecks className="h-3.5 w-3.5" />Plano de edição
      </div>
      <ul className="space-y-1 px-3 py-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px]">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/80" />
            <span>{s.replace(/^[-*✓•\s]+/, '')}</span>
          </li>
        ))}
      </ul>
      {actionable && (
        <div className="flex gap-2 border-t border-accent/20 px-3 py-2">
          <Button variant="primary" size="sm" onClick={onRun}><Wand2 className="h-3.5 w-3.5" />Executar edição</Button>
          <span className="self-center text-[11px] text-faint">ou escreva o que ajustar</span>
        </div>
      )}
    </div>
  )
}

function MessageBody({ text, actionable, onRun }: { text: string; actionable: boolean; onRun(): void }) {
  return (
    <div className="md selectable text-[13px] leading-relaxed">
      {splitBlocks(text).map((b, i) => {
        if (b.type === 'md') return <Markdown key={i} text={b.text} />
        if (b.lang === 'plano') return <PlanCard key={i} steps={b.text.split('\n').filter((l) => l.trim())} actionable={actionable} onRun={onRun} />
        if (b.lang === 'acao') return <div key={i} className="my-1 flex items-center gap-1.5 text-xs text-info"><RotateCcw className="h-3 w-3" />{b.text.trim()}</div>
        return <pre key={i}><code>{b.text}</code></pre>
      })}
    </div>
  )
}

function Activity({ items, open: initial = false }: { items: string[]; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  if (!items.length) return null
  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] text-faint hover:text-muted">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {items.length} ação(ões) do Claude
      </button>
      {open && (
        <ul className="selectable mt-1 space-y-0.5 border-l border-line-2 pl-2.5">
          {items.map((a, i) => <li key={i} className="truncate font-mono text-[10.5px] text-faint" title={a}>{a}</li>)}
        </ul>
      )}
    </div>
  )
}

function Bubble({ m, actionable, onRun }: { m: ChatMessage; actionable: boolean; onRun(): void }) {
  if (m.role === 'system') {
    return <p className="mx-auto max-w-[90%] text-center text-[11px] text-faint">{m.content}</p>
  }
  if (m.role === 'user') {
    return (
      <div className="ml-8 self-end rounded-xl rounded-br-sm bg-raised px-3 py-2 text-[13px] leading-relaxed selectable whitespace-pre-wrap">
        {m.content}
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Bot className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1">
        <MessageBody text={m.content} actionable={actionable} onRun={onRun} />
        <Activity items={m.activity} />
      </div>
    </div>
  )
}

export function ChatPanel() {
  const { projectId, messages, live, sendChat, chatFocusTick, toast } = useStore()
  const state = projectId ? live[projectId] : undefined
  const running = Boolean(state?.running)
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, state?.text, state?.activity.length])

  useEffect(() => {
    if (chatFocusTick) input.current?.focus()
  }, [chatFocusTick])

  const send = (t = text): void => {
    if (!t.trim() || running) return
    sendChat(t.trim())
    setText('')
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const reset = async (): Promise<void> => {
    if (!projectId) return
    await api.chat.resetSession(projectId)
    useStore.setState({ messages: await api.chat.history(projectId) })
    toast('Nova conversa iniciada', 'info')
  }

  return (
    <section className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Claude AI</span>
        <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'bg-accent animate-pulse' : 'bg-ok')} />
        <IconButton title="Nova conversa (o Claude esquece o histórico do chat)" className="ml-auto" onClick={reset} disabled={running}>
          <RotateCcw className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        {messages.length === 0 && !running && (
          <div className="flex flex-1 flex-col justify-end gap-3">
            <div className="text-center">
              <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Bot className="h-4 w-4" /></div>
              <p className="text-[13px] font-medium">Peça qualquer edição</p>
              <p className="mt-0.5 text-xs text-faint">O Claude usa o CLAUDE.md e o modelo de edição de E:\aqc.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-line px-3 py-1.5 text-left text-xs text-muted transition-colors hover:border-line-2 hover:bg-raised hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} m={m} actionable={!running && m.id === lastAssistant?.id && messages[messages.length - 1]?.id === m.id} onRun={() => send(APPROVE)} />
        ))}

        {running && state && (
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Bot className="h-3.5 w-3.5" /></div>
            <div className="min-w-0 flex-1">
              {state.text && <MessageBody text={state.text} actionable={false} onRun={() => {}} />}
              <div className="mt-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
                <p className="mb-1.5 text-xs text-muted">{state.status || 'Claude está trabalhando...'}</p>
                <Progress indeterminate />
              </div>
              <Activity items={state.activity} open />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2.5">
        <div className="flex items-end gap-2 rounded-xl border border-line-2 bg-bg p-1.5 focus-within:border-accent/60">
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder={running ? 'Claude está trabalhando...' : 'Ex.: junte os vídeos, tire as partes paradas e deixe pronto para Reels'}
            className="max-h-36 min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-faint"
          />
          {running ? (
            <IconButton title="Parar" onClick={() => projectId && api.chat.cancel(projectId)} className="bg-raised text-fg">
              <Square className="h-3.5 w-3.5 fill-current" />
            </IconButton>
          ) : (
            <button
              onClick={() => send()}
              disabled={!text.trim()}
              title="Enviar (Enter)"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-strong disabled:bg-raised disabled:text-faint"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-1 px-1 text-[10.5px] text-faint">Enter envia · Shift+Enter quebra linha</p>
      </div>
    </section>
  )
}
