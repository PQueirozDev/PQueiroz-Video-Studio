import { Fragment, type ReactNode } from 'react'

// Markdown mínimo para as respostas do Claude (sem dependências e sem HTML cru).

export type Block =
  | { type: 'md'; text: string }
  | { type: 'code'; lang: string; text: string }

export function splitBlocks(src: string): Block[] {
  const out: Block[] = []
  const re = /```(\w*)[^\n]*\n([\s\S]*?)(?:```|$)/g
  let last = 0
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'md', text: src.slice(last, m.index) })
    out.push({ type: 'code', lang: m[1].toLowerCase(), text: m[2].replace(/\n$/, '') })
    last = m.index! + m[0].length
  }
  if (last < src.length) out.push({ type: 'md', text: src.slice(last) })
  return out
}

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)
  return parts.map((p, i) => {
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
    return <Fragment key={i}>{p}</Fragment>
  })
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const nodes: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []

  const flushPara = (): void => {
    if (para.length) nodes.push(<p key={nodes.length}>{inline(para.join(' '))}</p>)
    para = []
  }
  const flushList = (): void => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    nodes.push(list.ordered ? <ol key={nodes.length} className="list-decimal">{items}</ol> : <ul key={nodes.length} className="list-disc">{items}</ul>)
    list = null
  }

  for (const line of lines) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      nodes.push(<h3 key={nodes.length}>{inline(heading[1])}</h3>)
    } else if (bullet || ordered) {
      flushPara()
      const isOrdered = Boolean(ordered)
      if (list && list.ordered !== isOrdered) flushList()
      if (!list) list = { ordered: isOrdered, items: [] }
      list.items.push((bullet ?? ordered)![1])
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return <>{nodes}</>
}
