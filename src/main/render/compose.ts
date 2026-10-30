import { clipEnd, clipLength, compositionDuration, TITLE_MEDIA, TITLE_REF, trackClips, type BlendMode, type Clip, type Composition, type MediaRef, type TitleSpec } from '@shared/composition'
import { effectById, transitionById } from '@shared/fx'
import { samples, toExpr, type AnimProp } from '@shared/keyframes'
import { filterPath, filterText } from '../media/filterArg'

// Compila a composição em UM comando do FFmpeg (filter_complex):
//  - cada trilha de vídeo vira uma faixa contínua (clipes + espaços transparentes, unidos por concat ou xfade);
//  - as trilhas são sobrepostas de baixo (V1) para cima sobre um fundo preto;
//  - todo áudio (dos vídeos e das trilhas de áudio) é posicionado com adelay e mixado;
//  - keyframes viram expressões por quadro (mesma interpolação do preview, em src/shared/keyframes.ts).
// Função pura: recebe caminhos e metadados, devolve argumentos. Testada com o FFmpeg real.

export interface RenderMedia extends MediaRef {
  path: string
}

export interface CompileAssets {
  /** id da LUT → caminho do .cube */
  luts?: Map<string, string>
  /** id da fonte → caminho do .ttf/.otf (títulos) */
  fonts?: Map<string, string>
}

/** Fonte usada quando a do título não está instalada. */
export const FALLBACK_FONT = 'poppins-bold'

/** Cor "neutra" de cada modo: pintada onde a trilha é transparente, não muda o que está embaixo. */
const BLEND: Record<Exclude<BlendMode, 'normal'>, { mode: string; neutral: string }> = {
  screen: { mode: 'screen', neutral: 'black' }, add: { mode: 'addition', neutral: 'black' }, lighten: { mode: 'lighten', neutral: 'black' },
  multiply: { mode: 'multiply', neutral: 'white' }, overlay: { mode: 'overlay', neutral: '0x808080' }, softlight: { mode: 'softlight', neutral: '0x808080' }
}

/** drawtext de cada linha do título sobre um quadro transparente do tamanho da saída. */
export function titleFilters(t: TitleSpec, w: number, h: number, fontPath: string): string[] {
  const size = Math.max(4, Math.round(t.size * h))
  const lineH = Math.round(size * t.lineSpacing)
  const text = t.uppercase ? t.text.toLocaleUpperCase('pt-BR') : t.text
  const lines = text.split('\n')
  const top = Math.round(t.y * h - (lines.length * lineH) / 2)
  const ax = Math.round(t.x * w)
  const x = t.align === 'left' ? `${ax}` : t.align === 'right' ? `${ax}-text_w` : `${ax}-text_w/2`
  const common = [
    `fontfile=${filterPath(fontPath)}`, `fontsize=${size}`, `fontcolor=${t.color}`, 'expansion=none', `x=${x}`
  ]
  if (t.outline > 0) common.push(`borderw=${Math.max(1, Math.round(t.outline * size))}`, `bordercolor=${t.outlineColor}`)
  if (t.shadow > 0) common.push(`shadowx=${Math.round(t.shadow * size)}`, `shadowy=${Math.round(t.shadow * size)}`, 'shadowcolor=black@0.55')
  if (t.box > 0) common.push('box=1', `boxcolor=${t.boxColor}@${t.box.toFixed(2)}`, `boxborderw=${Math.round(size * 0.22)}`)
  return lines.map((line, i) => {
    // Linha vazia só ocupa espaço (drawtext com texto vazio falha).
    if (!line.trim()) return 'null'
    // y centra a linha na sua faixa: (altura da faixa - (ascent - descent)) / 2.
    return `drawtext=${[...common, `text=${filterText(line)}`, `y=${top + i * lineH}+(${lineH}-ascent+descent)/2`].join(':')}`
  })
}

export interface CompiledGraph {
  /** Argumentos de entrada (-ss/-t/-i ...), na ordem dos índices usados no grafo. */
  inputArgs: string[]
  filter: string
  video: string
  audio: string
  duration: number
}

const t3 = (v: number): string => Number(v.toFixed(3)).toString()

/** O atempo aceita de 0,5 a 100 por filtro: abaixo de 0,5 encadeia vários. */
function atempo(speed: number): string[] {
  if (Math.abs(speed - 1) < 0.001) return []
  const out: string[] = []
  let s = speed
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5 }
  out.push(`atempo=${Number(s.toFixed(4))}`)
  return out
}
const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

export function compileComposition(doc: Composition, media: Map<string, RenderMedia>, size: { w: number; h: number; fps: number }, assets: CompileAssets = {}): CompiledGraph {
  const { w, h, fps } = size
  // Todo limite de vídeo cai num quadro inteiro: sem isso, durações fracionárias acumulam
  // diferença ao longo da trilha e os cortes deixam de bater com o áudio (posicionado em tempo absoluto).
  const q = (t: number): number => Math.round(t * fps) / fps
  const duration = q(compositionDuration(doc))
  if (duration <= 0) throw new Error('A timeline está vazia.')
  const tb = `settb=1/${fps}`
  const inputArgs: string[] = []
  const fc: string[] = []
  const inputIndex = new Map<string, number>()
  let nInputs = 0
  let label = 0
  const L = (p: string): string => `[${p}${label++}]`
  let named = 0

  /** Uma entrada por clipe, já cortada no trecho usado (o corte na entrada evita decodificar o arquivo inteiro). */
  const inputFor = (c: Clip, m: RenderMedia): number => {
    const existing = inputIndex.get(c.id)
    if (existing !== undefined) return existing
    if (m.kind === 'image') inputArgs.push('-loop', '1', '-framerate', String(fps), '-t', t3(clipLength(c)), '-i', m.path)
    // Lê o trecho do ARQUIVO (com velocidade, ele dura mais ou menos que o clipe na timeline).
    else inputArgs.push('-ss', t3(c.in), '-t', t3(c.hold > 0 ? 0.2 : c.out - c.in), '-i', m.path)
    inputIndex.set(c.id, nInputs)
    return nInputs++
  }
  const mediaOf = (c: Clip): RenderMedia => {
    if (c.mediaId === TITLE_MEDIA) return { ...TITLE_REF, path: '' }
    const m = media.get(c.mediaId)
    if (!m) throw new Error(`Arquivo ausente para o clipe ${c.id}. Reimporte ou reconecte o arquivo.`)
    return m
  }
  const keys = (c: Clip, p: AnimProp) => c.keyframes?.[p]
  const animated = (c: Clip, p: AnimProp): boolean => (keys(c, p)?.length ?? 0) > 0
  /** Valor estático ou expressão por quadro (`t` = tempo dentro do clipe). */
  const expr = (c: Clip, p: AnimProp, fallback: number, map?: (v: number) => number): string => toExpr(keys(c, p), fallback, 't', map)
  const range = (c: Clip, p: AnimProp, fallback: number): [number, number] => {
    const list = keys(c, p)
    if (!list?.length) return [fallback, fallback]
    return [Math.min(...list.map((k) => k.v)), Math.max(...list.map((k) => k.v))]
  }

  /** Enquadramento: escala (PiP), zoom, rotação e posição, estáticos ou animados. */
  const transformChain = (c: Clip): string[] => {
    const tf = c.transform
    const out: string[] = []
    const [sMin] = range(c, 'scale', tf.scale)
    const base = Math.min(1, sMin)
    // Escala menor que o quadro: reduz uma vez ao menor tamanho da animação, centrado num quadro transparente.
    if (base < 0.999) out.push(`scale=${even(w * base)}:${even(h * base)}:flags=bicubic`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`)
    // Daí em diante, crescer = zoom sobre o quadro fixo (o overlay do FFmpeg não acompanha tamanho variável).
    const zoomAnimated = animated(c, 'zoom') || animated(c, 'scale')
    if (zoomAnimated || tf.zoom > 1.001 || (base < 0.999 && tf.scale > base + 0.001)) {
      const z = `((${expr(c, 'scale', tf.scale)})/${t3(base)})*(${expr(c, 'zoom', tf.zoom)})`
      const ax = tf.zoom > 1.001 || animated(c, 'zoom') ? t3(tf.anchorX) : '0.5'
      const ay = tf.zoom > 1.001 || animated(c, 'zoom') ? t3(tf.anchorY) : '0.5'
      out.push(`scale=w='trunc(${w}*max(1,${z})/2)*2':h='trunc(${h}*max(1,${z})/2)*2':eval=frame:flags=bicubic`, `crop=${w}:${h}:x='(iw-${w})*${ax}':y='(ih-${h})*${ay}'`)
    }
    if (animated(c, 'rotation') || Math.abs(tf.rotation) > 0.01) out.push(`rotate=a='${expr(c, 'rotation', tf.rotation, (v) => (v * Math.PI) / 180)}':c=none:ow=iw:oh=ih`)
    // Posição: borda transparente do tamanho do maior deslocamento + recorte que anda por quadro.
    const [x0, x1] = range(c, 'x', tf.x)
    const [y0, y1] = range(c, 'y', tf.y)
    const mx = Math.min(1, Math.max(Math.abs(x0), Math.abs(x1)))
    const my = Math.min(1, Math.max(Math.abs(y0), Math.abs(y1)))
    if (mx > 0.0005 || my > 0.0005) {
      const px = even(w * mx)
      const py = even(h * my)
      out.push(`pad=${w + 2 * px}:${h + 2 * py}:${px}:${py}:color=black@0`,
        `crop=${w}:${h}:x='${px}-(${expr(c, 'x', tf.x)})*${w}':y='${py}-(${expr(c, 'y', tf.y)})*${h}'`)
    }
    return out
  }

  // ---------- vídeo ----------
  fc.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${t3(duration)},format=yuv420p[base]`)
  let canvas = '[base]'
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video' && !t.hidden)
  for (const track of videoTracks) {
    const clips = trackClips(doc, track.id)
    if (!clips.length) continue
    let acc = ''
    let accEnd = 0
    for (const c of clips) {
      const m = mediaOf(c)
      const start = q(c.start)
      const len = q(clipEnd(c)) - start
      let src: string
      if (c.title) {
        const font = assets.fonts?.get(c.title.font) ?? assets.fonts?.get(FALLBACK_FONT)
        if (!font) throw new Error('Nenhuma fonte instalada para os títulos. Reinstale o pacote essencial no Asset Hub.')
        const tl = L('ttl')
        fc.push(`color=c=black@0:s=${w}x${h}:r=${fps}:d=${t3(len)},format=rgba,${titleFilters(c.title, w, h, font).join(',')}${tl}`)
        src = tl
      } else src = `[${inputFor(c, m)}:v]`
      const chain = [
        // Freeze: estica o quadro antes do enquadramento para a animação (zoom, posição) andar sobre ele.
        c.hold > 0 ? `trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${t3(len)}` : c.speed !== 1 ? `setpts=(PTS-STARTPTS)/${t3(c.speed)}` : 'setpts=PTS-STARTPTS',
        `fps=${fps}`,
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=bicubic`,
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
        'setsar=1',
        'format=yuva420p',
        ...transformChain(c),
        // Garante a duração exata: estica o último quadro se o arquivo acabar antes e corta o excesso.
        `tpad=stop_mode=clone:stop_duration=${t3(len)}`,
        `trim=duration=${t3(len)}`,
        'setpts=PTS-STARTPTS',
        tb
      ]
      for (const e of c.effects) {
        const def = effectById(e.type)
        if (!e.enabled || !def || def.kind === 'audio') continue
        if (def.asset === 'lut') {
          const path = e.asset ? assets.luts?.get(e.asset) : undefined
          if (!path) throw new Error(`A LUT "${e.asset ?? '?'}" não está na biblioteca. Reinstale ou escolha outra.`)
          chain.push(def.filter(e.params, filterPath(path), { w, h }))
        } else chain.push(def.filter(e.params, undefined, { w, h }))
      }
      if (animated(c, 'brightness') || animated(c, 'contrast') || animated(c, 'saturation')) {
        chain.push(`eq=brightness='${expr(c, 'brightness', 0)}':contrast='${expr(c, 'contrast', 1)}':saturation='${expr(c, 'saturation', 1)}':eval=frame`)
      }
      // Desfoque e opacidade não aceitam expressão: o sendcmd troca o valor a cada quadro.
      const blurKeys = keys(c, 'blur')
      if (blurKeys?.length) {
        const name = `gblur@b${named++}`
        const cmds = samples(blurKeys, len, fps).map((s) => `${t3(s.t)} ${name} sigma ${t3(s.v)}`).join(';')
        chain.push(`sendcmd=c='${cmds}'`, `${name}=sigma=${t3(blurKeys[0].v)}`)
      }
      chain.push('format=yuva420p')
      const opKeys = keys(c, 'opacity')
      if (opKeys?.length) {
        const name = `colorchannelmixer@o${named++}`
        const cmds = samples(opKeys, len, fps).map((s) => `${t3(s.t)} ${name} aa ${t3(s.v * c.opacity)}`).join(';')
        chain.push('format=rgba', `sendcmd=c='${cmds}'`, `${name}=aa=${t3(opKeys[0].v * c.opacity)}`, 'format=yuva420p')
      } else if (c.opacity < 1) chain.push('format=rgba', `colorchannelmixer=aa=${t3(c.opacity)}`, 'format=yuva420p')
      if (c.fadeIn > 0) chain.push(`fade=t=in:st=0:d=${t3(c.fadeIn)}:alpha=1`)
      if (c.fadeOut > 0) chain.push(`fade=t=out:st=${t3(len - c.fadeOut)}:d=${t3(c.fadeOut)}:alpha=1`)
      const clipLabel = L('v')
      fc.push(`${src}${chain.join(',')}${clipLabel}`)

      const gap = start - accEnd
      if (!acc) {
        if (gap > 0.001) {
          const g = L('g')
          fc.push(`color=c=black@0:s=${w}x${h}:r=${fps}:d=${t3(gap)},format=yuva420p,setsar=1,${tb}${g}`)
          const out = L('t')
          fc.push(`${g}${clipLabel}concat=n=2:v=1:a=0${out}`)
          acc = out
        } else acc = clipLabel
      } else if (c.transitionIn) {
        const def = transitionById(c.transitionIn.type)
        const d = q(c.transitionIn.duration)
        const left = L('x')
        const out = L('t')
        // xfade exige a mesma base de tempo nas duas entradas (a saída do concat pode vir diferente).
        fc.push(`${acc}${tb}${left}`)
        fc.push(`${left}${clipLabel}xfade=transition=${def?.xfade ?? 'fade'}:duration=${t3(d)}:offset=${t3(accEnd - d)}${out}`)
        acc = out
      } else {
        const parts = [acc]
        if (gap > 0.001) {
          const g = L('g')
          fc.push(`color=c=black@0:s=${w}x${h}:r=${fps}:d=${t3(gap)},format=yuva420p,setsar=1,${tb}${g}`)
          parts.push(g)
        }
        parts.push(clipLabel)
        const out = L('t')
        fc.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0${out}`)
        acc = out
      }
      accEnd = start + len
    }
    const out = L('o')
    const blend = track.blend && track.blend !== 'normal' ? BLEND[track.blend] : null
    if (blend) {
      // Trilha achatada sobre a cor neutra do modo e mesclada em RGB (mesclar em YUV erra as cores).
      const flat = L('f')
      fc.push(`color=c=${blend.neutral}:s=${w}x${h}:r=${fps}:d=${t3(duration)},format=yuva420p[nb${label}]`)
      fc.push(`[nb${label}]${acc}overlay=x=0:y=0:eof_action=pass:format=auto,format=gbrp${flat}`)
      const under = L('u')
      fc.push(`${canvas}format=gbrp${under}`)
      fc.push(`${under}${flat}blend=all_mode=${blend.mode}:shortest=1,format=yuv420p${out}`)
    } else fc.push(`${canvas}${acc}overlay=x=0:y=0:eof_action=pass:format=auto${out}`)
    canvas = out
  }
  fc.push(`${canvas}format=yuv420p[vout]`)

  // ---------- áudio ----------
  // "Fala/jogo" = som dos clipes de vídeo; "música" = trilhas de áudio (separados para o ducking).
  const voice: string[] = []
  const music: string[] = []
  for (const track of doc.tracks) {
    if (track.muted) continue
    const clips = trackClips(doc, track.id)
    clips.forEach((c, idx) => {
      const m = mediaOf(c)
      const volKeys = keys(c, 'volume')
      if ((c.volume <= 0 && !volKeys?.length) || m.kind === 'image' || !m.hasAudio || c.hold > 0) return
      const i = inputFor(c, m)
      const len = clipLength(c)
      // Nas transições, o áudio cruza junto: o anterior some e o próximo entra durante a sobreposição.
      const next = clips[idx + 1]
      const xin = c.transitionIn?.duration ?? 0
      const xout = next?.transitionIn?.duration ?? 0
      const fadeIn = Math.max(c.fadeIn, xin)
      const fadeOut = Math.max(c.fadeOut, xout)
      const chain = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...atempo(c.speed), 'apad', `atrim=0:${t3(len)}`, 'asetpts=PTS-STARTPTS']
      for (const e of c.effects) {
        const def = effectById(e.type)
        if (e.enabled && def?.kind === 'audio') chain.push(def.filter(e.params))
      }
      if (volKeys?.length) chain.push(`volume=volume='(${expr(c, 'volume', 1)})*${t3(c.volume)}':eval=frame`)
      else if (c.volume !== 1) chain.push(`volume=${t3(c.volume)}`)
      if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${t3(fadeIn)}`)
      if (fadeOut > 0) chain.push(`afade=t=out:st=${t3(Math.max(0, len - fadeOut))}:d=${t3(fadeOut)}`)
      // Efeitos como o normalizador podem alterar o comprimento por alguns ms: recorta de novo.
      chain.push('apad', `atrim=0:${t3(len)}`)
      const ms = Math.round(c.start * 1000)
      if (ms > 0) chain.push(`adelay=${ms}:all=1`)
      const out = L('a')
      fc.push(`[${i}:a]${chain.join(',')}${out}`)
      ;(track.kind === 'audio' ? music : voice).push(out)
    })
  }
  const bus = (labels: string[], name: string): string => {
    const silent = L('s')
    fc.push(`anullsrc=r=48000:cl=stereo,atrim=0:${t3(duration)}${silent}`)
    const out = `[${name}]`
    fc.push(`${silent}${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:normalize=0:dropout_transition=0${out}`)
    return out
  }
  let mixed: string
  if (doc.mix.duck && voice.length && music.length) {
    // Ducking: a música é comprimida pelo próprio sinal da fala/jogo (sidechain).
    const v = bus(voice, 'avoice')
    const mu = bus(music, 'amusic')
    fc.push(`${v}asplit=2[vkey][vmain]`)
    const ratio = t3(1 + doc.mix.duckAmount * 19)
    fc.push(`${mu}[vkey]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=20:release=350:makeup=1[aducked]`)
    fc.push('[vmain][aducked]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[amixed]')
    mixed = '[amixed]'
  } else mixed = bus([...voice, ...music], 'amixed')
  // loudnorm de uma passada não garante o pico, e o AAC ainda soma um pouco: limitador com folga (-2 dBFS),
  // medido em 4x (true peak), para a entrega ficar ≤ -1 dBTP.
  const ceiling = 'aresample=192000,alimiter=limit=0.794:attack=1:release=60:level=false,aresample=48000'
  if (doc.mix.normalize) fc.push(`${mixed}loudnorm=I=${t3(doc.mix.targetLufs)}:TP=-2:LRA=11,${ceiling},apad,atrim=0:${t3(duration)}[aout]`)
  else fc.push(`${mixed}anull[aout]`)

  return { inputArgs, filter: fc.join(';\n'), video: '[vout]', audio: '[aout]', duration }
}
