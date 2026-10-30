import { BLEND_MODES, clipEnd, trackClips, type Command, type Composition } from '@shared/composition'
import { EFFECTS, TRANSITIONS } from '@shared/fx'
import { ANIM_PROPS } from '@shared/keyframes'
import { findHighlights } from '@shared/highlights'
import { presetToCommands, AUTO_STYLES, type AutoStyle } from '@shared/autoStudio'
import { captionCommands } from '@shared/captions'
import type { MediaAnalysis } from '@shared/analysis'
import { analyze, runTranscription } from '../analysis/ipc'
import { installedModels } from '../analysis/whisper'
import { listLuts } from '../assets/luts'
import { runAutoStudio } from '../auto/autoStudio'
import { editComposition, getComposition, travelComposition } from '../composition/store'
import { listMedia } from '../media/media'
import { loadSubtitles } from '../media/subtitles'
import { assembleTimeline } from '../media/timeline'
import { hubItem, hubItems, useHubItem } from '../packs/packs'
import { requireProject } from '../projects/projects'
import { applyStyleToProject, learnFromProject, listStyles, projectStyle, setProjectStyle } from '../styles/styles'
import { getBrand } from '../image/brands'
import { describeStyle } from '@shared/style'
import { checkProject, checkProjectRender } from '../qc/qc'

// Execução das ferramentas do agente (chamadas pelo servidor MCP através da ponte local).
// Respostas compactas: o agente lê JSON curto, sem caminhos internos desnecessários.

type Args = Record<string, unknown>
const r2 = (v: number): number => Math.round(v * 100) / 100
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const n = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)

function summarize(projectId: string, doc: Composition): unknown {
  const media = listMedia(projectId)
  const name = (id: string): string => media.find((m) => m.id === id)?.name ?? '?'
  return {
    duracao: r2(Math.max(0, ...doc.clips.map(clipEnd))),
    trilhas: doc.tracks.map((t) => ({ id: t.id, tipo: t.kind, nome: t.name, ...(t.muted ? { mudo: true } : {}), ...(t.hidden ? { oculta: true } : {}), ...(t.locked ? { bloqueada: true } : {}), ...(t.blend ? { mesclagem: t.blend } : {}) })),
    clipes: doc.tracks.flatMap((t) => trackClips(doc, t.id).map((c) => ({
      id: c.id, trilha: t.id, ...(c.title ? { titulo: c.title.text, fonte: c.title.font } : { midia: name(c.mediaId), mediaId: c.mediaId, in: r2(c.in), out: r2(c.out) }),
      inicio: r2(c.start), fim: r2(clipEnd(c)),
      ...(c.speed !== 1 ? { velocidade: c.speed } : {}), ...(c.hold > 0 ? { freeze: c.hold } : {}), ...(c.volume !== 1 ? { volume: c.volume } : {}),
      ...(c.effects.length ? { efeitos: c.effects.map((e) => ({ id: e.id, tipo: e.type, ...(e.asset ? { asset: e.asset } : {}) })) } : {}),
      ...(c.transitionIn ? { transicao: c.transitionIn } : {}),
      ...(Object.keys(c.keyframes).length ? { animado: Object.keys(c.keyframes) } : {}),
      ...(c.group ? { grupo: c.group } : {})
    }))),
    marcadores: doc.markers.map((m) => ({ id: m.id, tempo: m.time, texto: m.label })),
    mixagem: doc.mix
  }
}

function analysisSummary(a: MediaAnalysis): unknown {
  return {
    duracao: r2(a.duration), cenas: a.scenes.slice(0, 60).map(r2), silencios: a.silences.slice(0, 60).map((x) => [r2(x.start), r2(x.end)]),
    transientes: a.transients.slice(0, 60).map(r2), loudness: a.loudness, riscoDeClip: a.clippingRisk,
    ...(a.music ? { musica: { bpm: Math.round(a.music.bpm), batidas: a.music.beats.length, primeirasBatidas: a.music.beats.slice(0, 32).map(r2), confianca: r2(a.music.confidence) } } : {})
  }
}

/** Trilha livre no intervalo (cria uma nova se precisar): comandos + o id a usar ("$0" quando criada). */
function trackFor(doc: Composition, kind: 'video' | 'audio', start: number, end: number, name: string): { pre: Command[]; trackId: string } {
  const main = doc.tracks.find((t) => t.kind === kind)?.id
  const free = doc.tracks.filter((t) => t.kind === kind && !t.locked && !t.hidden && !t.muted && (kind === 'audio' || t.id !== main))
    .reverse().find((t) => trackClips(doc, t.id).every((c) => clipEnd(c) <= start + 0.002 || c.start >= end - 0.002))
  return free ? { pre: [], trackId: free.id } : { pre: [{ type: 'addTrack', kind, name }], trackId: '$0' }
}

function mediaItem(projectId: string, id: unknown) {
  const m = listMedia(projectId).find((x) => x.id === id)
  if (!m) throw new Error(`Mídia não encontrada: ${String(id)}. Use estado_projeto para ver os ids.`)
  return m
}

export async function callTool(projectId: string, name: string, args: Args, signal?: AbortSignal): Promise<unknown> {
  requireProject(projectId)
  // Toda gravação passa por aqui: se a sessão do chat acabou (cancelada), nada muda no projeto.
  const commit = (cmds: Command[]) => {
    if (signal?.aborted) throw new Error('Pedido cancelado: a edição não foi aplicada.')
    return editComposition(projectId, cmds)
  }
  const edited = (r: { doc: Composition; createdIds?: (string | undefined)[] }) => ({ ok: true, criados: r.createdIds?.filter(Boolean) ?? [], projeto: summarize(projectId, r.doc) })
  switch (name) {
    case 'estado_projeto': {
      const media = listMedia(projectId).map((m) => ({ id: m.id, nome: m.name, tipo: m.kind, duracao: m.duration == null ? null : r2(m.duration), audio: m.hasAudio, ...(m.width ? { resolucao: `${m.width}x${m.height}` } : {}) }))
      return { midias: media, ...(summarize(projectId, getComposition(projectId).doc) as object) }
    }
    case 'catalogo': {
      const tipo = s(args.tipo) || 'tudo'
      const out: Record<string, unknown> = {}
      if (tipo === 'tudo' || tipo === 'transicoes') out.transicoes = TRANSITIONS.map((t) => ({ id: t.id, nome: t.name, duracaoPadrao: t.defaultDuration }))
      if (tipo === 'tudo' || tipo === 'efeitos') out.efeitos = EFFECTS.map((e) => ({ id: e.id, nome: e.name, tipo: e.kind ?? 'video', ...(e.asset ? { precisaDeAsset: e.asset } : {}), params: e.params.map((p) => ({ chave: p.key, nome: p.label, min: p.min, max: p.max, padrao: p.default })) }))
      if (tipo === 'tudo' || tipo === 'luts') out.luts = listLuts().map((l) => ({ id: l.id, nome: l.name }))
      if (tipo === 'tudo') {
        out.propriedadesAnimaveis = ANIM_PROPS.map((p) => ({ id: p.id, min: p.min, max: p.max, neutro: p.neutral }))
        out.mesclagens = BLEND_MODES.map((b) => b.id)
        out.estilosAutoStudio = AUTO_STYLES.map((a) => ({ id: a.id, descricao: a.description }))
      }
      if (tipo === 'tudo' || tipo === 'hub') out.assets = hubItems().filter((i) => i.type !== 'lut').map((i) => ({ chave: i.key, tipo: i.type, nome: i.name, ...(i.tags?.length ? { tags: i.tags } : {}), ...(i.type === 'font' ? { fonteId: i.packId === 'pq-essentials' ? i.id : `${i.packId}.${i.id}` } : {}) }))
      return out
    }
    case 'editar_timeline': {
      if (!Array.isArray(args.commands)) throw new Error('Envie "commands" como lista.')
      return edited(commit(args.commands as Command[]))
    }
    case 'desfazer':
      if (signal?.aborted) throw new Error('Pedido cancelado.')
      return { ok: true, projeto: summarize(projectId, travelComposition(projectId, 'undo').doc) }
    case 'analisar_midia': {
      const m = mediaItem(projectId, args.mediaId)
      return analysisSummary(await analyze(projectId, m.id, args.musica === true))
    }
    case 'melhores_momentos': {
      const ids = Array.isArray(args.mediaIds) ? args.mediaIds : []
      if (!ids.length || ids.length > 50) throw new Error('Envie de 1 a 50 mediaIds.')
      const length = n(args.duracao, 3)
      const count = n(args.quantidade, 10)
      if (length < 1 || length > 120 || count < 1 || count > 100) throw new Error('duracao 1–120 s e quantidade 1–100.')
      const analyses: MediaAnalysis[] = []
      for (const id of ids) analyses.push(await analyze(projectId, mediaItem(projectId, id).id))
      return findHighlights(analyses, { length, count, mode: args.modo === 'geral' ? 'geral' : 'gameplay' }).map((h) => ({ mediaId: h.mediaId, inicio: r2(h.start), fim: r2(h.end), nota: r2(h.score), motivos: h.reasons }))
    }
    case 'auto_studio': {
      const style = s(args.estilo) as AutoStyle
      const r = await runAutoStudio(projectId, { style, mediaIds: (Array.isArray(args.mediaIds) ? args.mediaIds : []) as string[], musicId: s(args.musicaId) || null, targetDuration: n(args.duracao, 30), title: s(args.titulo) || undefined,
        styleId: s(args.estiloId) === 'nenhum' ? null : s(args.estiloId) || undefined }, signal)
      return { ...r, projeto: summarize(projectId, getComposition(projectId).doc) }
    }
    case 'usar_asset': {
      const it = hubItem(s(args.chave))
      const doc = getComposition(projectId).doc
      const start = Math.max(0, n(args.inicio, 0))
      if (it.type === 'sfx' || it.type === 'overlay') {
        const m = await useHubItem(projectId, it.key)
        const len = m.duration ?? 3
        const kind = it.type === 'sfx' ? 'audio' : 'video'
        const { pre, trackId } = trackFor(doc, kind, start, start + len, it.type === 'sfx' ? 'Efeitos sonoros' : 'Overlays')
        const cmds: Command[] = [...pre, { type: 'addClip', mediaId: m.id, trackId, start }]
        if (kind === 'video') cmds.push({ type: 'updateTrack', trackId, blend: it.blend && it.blend !== 'normal' ? it.blend : 'screen' })
        return edited(commit(cmds))
      }
      if (it.type === 'title' && it.title) {
        const t = it.title
        return edited(commit([{ type: 'addTitle', start, duration: t.duration, title: { ...t.style, ...(s(args.texto) ? { text: s(args.texto) } : {}) }, keyframes: t.keyframes, fadeIn: t.fadeIn, fadeOut: t.fadeOut }]))
      }
      if (it.type === 'preset' && it.preset) {
        const c = doc.clips.find((x) => x.id === args.clipId)
        if (!c) throw new Error('Presets precisam de "clipId" (um clipe de vídeo da timeline).')
        const len = clipEnd(c) - c.start
        const at = it.preset.anchor === 'start' ? 0 : Math.min(len, Math.max(0, start - c.start))
        return edited(commit(presetToCommands(it.preset, c.id, len, at, c.keyframes)))
      }
      throw new Error('Fontes e LUTs não são "usados" diretamente: use o id no título (font) ou no efeito "lut" (asset).')
    }
    case 'transcrever': {
      const m = mediaItem(projectId, args.mediaId)
      if (m.kind !== 'video') throw new Error('Transcrição só para vídeos do projeto.')
      const installed = installedModels()
      const model = s(args.modelo) || installed[0]
      if (!model) throw new Error('Nenhum modelo de transcrição instalado. Peça ao usuário para baixar em Legendas → Transcrever.')
      const doc = await runTranscription(projectId, m.path, { model, language: s(args.idioma) || 'pt' })
      return { legendas: doc.cues.length, falas: doc.cues.slice(0, 200).map((c) => ({ inicio: r2(c.start), fim: r2(c.end), texto: c.text })) }
    }
    case 'legendas_na_timeline': {
      const m = mediaItem(projectId, args.mediaId)
      const cues = loadSubtitles(projectId, m.path).cues
      if (!cues.length) throw new Error('Esse vídeo ainda não tem legendas: chame transcrever antes.')
      const key = s(args.template) || 'pq-essentials/legenda-tiktok'
      const template = hubItems('title').find((i) => i.key === key)?.title
      const cmds = captionCommands(getComposition(projectId).doc, m.id, cues, template)
      if (!cmds.length) throw new Error('Nenhuma fala cai em trechos desse vídeo que estão na timeline.')
      return edited(commit(cmds))
    }
    case 'verificar_qualidade': {
      const preset = s(args.destino) || undefined
      const timeline = checkProject(projectId, preset).map(({ fix, fixLabel, ...i }) => ({ ...i, ...(fix ? { correcao: fix, acao: fixLabel } : {}) }))
      const out: Record<string, unknown> = { timeline, ok: !timeline.some((i) => i.level === 'erro') }
      if (args.arquivo === true) {
        const r = await checkProjectRender(projectId, { presetId: preset })
        out.arquivo = { caminho: r.path, itens: r.items, medidas: { duracao: r.measures.duration, resolucao: `${r.measures.width}x${r.measures.height}`, mb: Math.round(r.measures.bytes / 104857.6) / 10, lufs: r.measures.integrated, picoDbtp: r.measures.truePeak } }
      }
      return out
    }
    case 'estilos': {
      const cur = projectStyle(projectId)
      return {
        projeto: { cliente: cur.brandId ? getBrand(cur.brandId)?.name ?? null : null, estiloId: cur.styleId },
        estilos: listStyles().map((x) => ({ id: x.id, nome: x.name, cliente: x.brandId ? getBrand(x.brandId)?.name ?? null : null, resumo: describeStyle(x), instrucoes: x.notes || undefined, autoStudio: x.autoStyle }))
      }
    }
    case 'aprender_estilo': {
      if (signal?.aborted) throw new Error('Pedido cancelado.')
      const st = learnFromProject(projectId, { name: s(args.nome), notes: s(args.observacoes) || undefined })
      setProjectStyle(projectId, { styleId: st.id })
      return { ok: true, id: st.id, resumo: describeStyle(st) }
    }
    case 'aplicar_estilo': {
      if (signal?.aborted) throw new Error('Pedido cancelado.')
      const r = applyStyleToProject(projectId, s(args.estiloId))
      return { ok: true, mudancas: r.commands, projeto: summarize(projectId, getComposition(projectId).doc) }
    }
    case 'gerar_versao': {
      if (signal?.aborted) throw new Error('Pedido cancelado.')
      const versions = await assembleTimeline(projectId)
      const v = versions[0]
      return { ok: true, versao: v ? { id: v.id, nome: v.label, arquivo: v.path } : null }
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${name}`)
  }
}
