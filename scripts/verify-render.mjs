import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

// Testes de render com o FFmpeg REAL: gera mídias sintéticas, aplica comandos de edição,
// compila a composição e confere o arquivo final (duração, cores, áudio).
// Todas as transições e efeitos do catálogo são renderizados pelo menos uma vez.

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const ffprobe = process.env.FFPROBE ?? 'ffprobe'
if (spawnSync(ffmpeg, ['-version']).status !== 0) {
  console.log('FFmpeg não encontrado: testes de render ignorados.')
  process.exit(0)
}

const bundle = await build({
  stdin: { contents: `export * as comp from './src/shared/composition'; export * as fx from './src/shared/fx'; export * as compose from './src/main/render/compose'; export * as encode from './src/main/render/encode'; export * as slice from './src/shared/slice'; export * as auto from './src/shared/autoStudio'; export * as qc from './src/shared/qc'; export * as presets from './src/shared/exportPresets'; export * as size from './src/main/render/size';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  alias: { '@shared': './src/shared' }
})
const { comp, fx, compose, encode, slice, auto, qc, presets, size } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

const dir = mkdtempSync(join(tmpdir(), 'pqueiroz-render-'))
const ff = (...args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
const probe = (file) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString())
/** Cor média (r,g,b) de um quadro em `t` segundos, reduzido a 1x1. */
const colorAt = (file, t) => {
  const buf = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [buf[0], buf[1], buf[2]]
}
/** Cor média de uma região (x, y, largura, altura em pixels) do quadro em `t`. */
const colorIn = (file, t, x, y, w, h) => {
  const buf = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return [buf[0], buf[1], buf[2]]
}
/** Loudness integrada (LUFS) do arquivo inteiro. */
const integrated = (file) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'])
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.toString().split('Summary:').pop())
  return m ? Number(m[1]) : null
}
/** Volume médio (dB) de um trecho de áudio. */
const meanVolume = (file, start, dur) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-ss', String(start), '-t', String(dur), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  const m = /mean_volume: (-?[\d.]+) dB/.exec(r.stderr.toString())
  return m ? Number(m[1]) : -120
}

let checks = 0
const check = async (name, fn) => { await fn(); checks++; console.log(`OK ${name}`) }

try {
  // Mídias de teste: vermelho com tom de 440 Hz, azul sem áudio, imagem verde, trilha sonora de 880 Hz.
  const red = join(dir, 'red.mp4'), blue = join(dir, 'blue.mp4'), green = join(dir, 'green.png'), music = join(dir, 'music.m4a')
  ff('-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red)
  ff('-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue)
  ff('-f', 'lavfi', '-i', 'color=c=lime:s=200x200', '-frames:v', '1', green)
  ff('-f', 'lavfi', '-i', 'sine=frequency=880:duration=10', '-c:a', 'aac', music)

  const split = join(dir, 'split.png'), voice = join(dir, 'voice.m4a'), lut = join(dir, 'inverte.cube')
  ff('-f', 'lavfi', '-i', 'color=c=red:s=160x180', '-f', 'lavfi', '-i', 'color=c=blue:s=160x180', '-filter_complex', '[0:v][1:v]hstack', '-frames:v', '1', split)
  ff('-f', 'lavfi', '-i', 'sine=frequency=300:duration=10', '-c:a', 'aac', voice)
  // LUT 2x2x2 que inverte as cores (r,g,b -> 1-r,1-g,1-b); ordem do .cube: r varia mais rápido.
  const lines = ['LUT_3D_SIZE 2']
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`)
  writeFileSync(lut, lines.join('\n') + '\n')
  const fontDir = join('resources', 'packs', 'pq-essentials', 'fonts')
  const assets = { luts: new Map([['inverte', lut]]), fonts: new Map([['poppins-bold', join(fontDir, 'Poppins-Bold.ttf')], ['anton', join(fontDir, 'Anton-Regular.ttf')]]) }
  const media = new Map([
    ['split', { id: 'split', kind: 'image', duration: null, hasAudio: false, path: split }],
    ['voice', { id: 'voice', kind: 'audio', duration: 10, hasAudio: true, path: voice }],
    ['red', { id: 'red', kind: 'video', duration: 4, hasAudio: true, path: red }],
    ['blue', { id: 'blue', kind: 'video', duration: 4, hasAudio: false, path: blue }],
    ['green', { id: 'green', kind: 'image', duration: null, hasAudio: false, path: green }],
    ['music', { id: 'music', kind: 'audio', duration: 10, hasAudio: true, path: music }]
  ])
  let seq = 0
  const ctx = { media, newId: (p) => `${p}${++seq}` }
  const apply = (doc, cmd) => comp.applyCommand(doc, cmd, ctx)
  const render = (doc, name, size = { w: 320, h: 180, fps: 30 }) => {
    const out = join(dir, name)
    const g = compose.compileComposition(doc, media, size, assets)
    const script = join(dir, `${name}.filter`)
    writeFileSync(script, g.filter)
    ff(...encode.compositionArgs(g, script, encode.encoderArgs('libx264', 'rapida'), out))
    return out
  }

  // 1) Sequência com espaço vazio, imagem e corte.
  let doc = comp.emptyComposition()
  let r = apply(doc, { type: 'addClip', mediaId: 'red', in: 1, out: 3 }); doc = r.doc; const c1 = r.createdId
  r = apply(doc, { type: 'addClip', mediaId: 'green', start: 3, out: 1.5 }); doc = r.doc
  await check('composição simples tem 4,5 s e respeita o espaço vazio', () => {
    const out = render(doc, 'seq.mp4')
    const info = probe(out)
    assert.ok(Math.abs(Number(info.format.duration) - 4.5) < 0.1, `duração ${info.format.duration}`)
    const v = info.streams.find((s) => s.codec_type === 'video')
    assert.equal(v.width, 320); assert.equal(v.height, 180)
    const [rr, gg, bb] = colorAt(out, 1); assert.ok(rr > 150 && gg < 80 && bb < 80, `vermelho esperado, veio ${rr},${gg},${bb}`)
    const gap = colorAt(out, 2.5); assert.ok(gap.every((x) => x < 30), `preto esperado no espaço vazio, veio ${gap}`)
    const img = colorAt(out, 3.8); assert.ok(img[1] > 150 && img[0] < 80, `verde esperado, veio ${img}`)
    assert.ok(meanVolume(out, 0.3, 1) > -30, 'o tom do clipe vermelho deveria estar no áudio')
    assert.ok(meanVolume(out, 2.2, 0.6) < -60, 'silêncio esperado no espaço vazio')
  })

  // 2) Duas trilhas: imagem verde por cima (PiP com opacidade), música na trilha de áudio.
  doc = comp.emptyComposition()
  doc = apply(doc, { type: 'addClip', mediaId: 'blue' }).doc
  r = apply(doc, { type: 'addTrack', kind: 'video' }); doc = r.doc; const v2 = r.createdId
  r = apply(doc, { type: 'addClip', mediaId: 'green', trackId: v2, start: 1, out: 2 }); doc = r.doc; const top = r.createdId
  r = apply(doc, { type: 'addClip', mediaId: 'music', in: 0, out: 4 }); doc = r.doc; const mus = r.createdId
  doc = apply(doc, { type: 'setClipProps', clipId: mus, volume: 0.5 }).doc
  await check('trilha de cima cobre a de baixo só no seu intervalo; música mixada', () => {
    const out = render(doc, 'tracks.mp4')
    const under = colorAt(out, 0.5); assert.ok(under[2] > 150 && under[1] < 80, `azul esperado, veio ${under}`)
    const over = colorAt(out, 2); assert.ok(over[1] > 100, `verde por cima esperado, veio ${over}`)
    assert.ok(meanVolume(out, 0.5, 2) > -40, 'música deveria tocar')
  })
  await check('ocultar trilha e silenciar trilha afetam o render', () => {
    let d = apply(doc, { type: 'updateTrack', trackId: v2, hidden: true }).doc
    d = apply(d, { type: 'updateTrack', trackId: 'A1', muted: true }).doc
    const out = render(d, 'hidden.mp4')
    const c = colorAt(out, 2); assert.ok(c[2] > 150 && c[1] < 80, `azul esperado com V2 oculta, veio ${c}`)
    assert.ok(meanVolume(out, 0.5, 2) < -60, 'A1 silenciada não deveria ter som')
  })
  await check('trilha bloqueada recusa edição', () => {
    const d = apply(doc, { type: 'updateTrack', trackId: v2, locked: true }).doc
    assert.throws(() => apply(d, { type: 'moveClip', clipId: top, start: 0 }), /bloqueada/)
  })

  // 3) Transição: o segundo clipe recua para sobrepor; duração final diminui.
  doc = comp.emptyComposition()
  doc = apply(doc, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc
  r = apply(doc, { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }); doc = r.doc; const second = r.createdId
  doc = apply(doc, { type: 'setTransition', clipId: second, transition: { type: 'cross-dissolve', duration: 1 } }).doc
  await check('transição sobrepõe os clipes (3 s no total) e mistura as cores no meio', () => {
    assert.equal(comp.compositionDuration(doc), 3)
    const out = render(doc, 'xfade.mp4')
    assert.ok(Math.abs(Number(probe(out).format.duration) - 3) < 0.1)
    const mid = colorAt(out, 1.5); assert.ok(mid[0] > 60 && mid[2] > 60, `mistura esperada, veio ${mid}`)
    const end = colorAt(out, 2.7); assert.ok(end[2] > 150 && end[0] < 60, `azul esperado, veio ${end}`)
  })
  await check('transição fecha o espaço vazio entre os clipes', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc
    const b = apply(d, { type: 'addClip', mediaId: 'blue', start: 2.6, in: 0, out: 2 }); d = b.doc
    d = apply(d, { type: 'setTransition', clipId: b.createdId, transition: { type: 'cross-dissolve', duration: 0.5 } }).doc
    assert.equal(d.clips.find((c) => c.id === b.createdId).start, 1.5)
  })
  await check('remover a transição devolve o espaço', () => {
    const d = apply(doc, { type: 'setTransition', clipId: second, transition: null }).doc
    assert.equal(comp.compositionDuration(d), 4)
  })
  await check('todas as transições do catálogo renderizam', () => {
    const size = { w: 160, h: 90, fps: 15 }
    for (const t of fx.TRANSITIONS) {
      const d = apply(doc, { type: 'setTransition', clipId: second, transition: { type: t.id, duration: 0.4 } }).doc
      render(d, `t-${t.id}.mp4`, size)
    }
  })

  // 4) Efeitos.
  await check('todos os efeitos do catálogo renderizam com parâmetros', () => {
    const size = { w: 160, h: 90, fps: 15 }
    for (const e of fx.EFFECTS) {
      const d0 = comp.emptyComposition()
      const a = apply(d0, { type: 'addClip', mediaId: 'red', in: 0, out: 0.6 })
      const params = Object.fromEntries(e.params.map((p) => [p.key, (p.min + p.max) / 2]))
      render(apply(a.doc, { type: 'addEffect', clipId: a.createdId, effect: e.id, params, asset: e.asset ? 'inverte' : undefined }).doc, `e-${e.id}.mp4`, size)
    }
  })
  await check('efeito preto e branco remove a cor de verdade', () => {
    const d0 = comp.emptyComposition()
    const a = apply(d0, { type: 'addClip', mediaId: 'red', in: 0, out: 1 })
    const out = render(apply(a.doc, { type: 'addEffect', clipId: a.createdId, effect: 'black-white' }).doc, 'bw.mp4')
    const [x, y, z] = colorAt(out, 0.5); assert.ok(Math.abs(x - y) < 12 && Math.abs(y - z) < 12, `cinza esperado, veio ${x},${y},${z}`)
  })

  // 5) Comandos e validação.
  await check('dividir clipe gera dois clipes contíguos com trechos corretos', () => {
    let d = comp.emptyComposition()
    const a = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 4 }); d = a.doc
    const s = apply(d, { type: 'splitClip', clipId: a.createdId, at: 1.5 }); d = s.doc
    const [x, y] = comp.trackClips(d, 'V1')
    assert.deepEqual([x.in, x.out, y.start, y.in, y.out], [0, 1.5, 1.5, 1.5, 4])
  })
  await check('remover com ripple fecha o buraco', () => {
    let d = comp.emptyComposition()
    const a = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }); d = a.doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    d = apply(d, { type: 'removeClip', clipId: a.createdId, ripple: true }).doc
    assert.equal(comp.trackClips(d, 'V1')[0].start, 0)
  })
  await check('corte com ripple empurra os seguintes', () => {
    let d = comp.emptyComposition()
    const a = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }); d = a.doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    d = apply(d, { type: 'trimClip', clipId: a.createdId, out: 1, ripple: true }).doc
    assert.equal(comp.trackClips(d, 'V1')[1].start, 1)
  })
  await check('validação recusa sobreposição, áudio em trilha de vídeo, corte além do arquivo e efeito inventado', () => {
    let d = comp.emptyComposition()
    d = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc
    assert.throws(() => apply(d, { type: 'addClip', mediaId: 'blue', start: 1 }), /sobrepõem/)
    assert.throws(() => apply(d, { type: 'addClip', mediaId: 'music', trackId: 'V1' }), /não aceita/)
    assert.throws(() => apply(d, { type: 'addClip', mediaId: 'red', start: 5, in: 0, out: 9 }), /fim do arquivo/)
    assert.throws(() => apply(d, { type: 'addEffect', clipId: d.clips[0].id, effect: 'teletransporte' }), /desconhecido/)
    assert.throws(() => apply(d, { type: 'rm -rf' }), /desconhecido/)
  })
  // Regressões da revisão do Codex.
  const twoWithTransition = () => {
    let d = comp.emptyComposition()
    const a = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 4 }); d = a.doc
    const b = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 4 }); d = b.doc
    d = apply(d, { type: 'setTransition', clipId: b.createdId, transition: { type: 'cross-dissolve', duration: 1 } }).doc
    return { d, a: a.createdId, b: b.createdId }
  }
  await check('ripple no fim de um clipe arrasta o seguinte que o sobrepõe por transição', () => {
    const { d, a, b } = twoWithTransition()
    const r = apply(d, { type: 'trimClip', clipId: a, out: 3, ripple: true }).doc
    assert.equal(r.clips.find((c) => c.id === b).start, 2)
  })
  await check('ripple no início mantém o clipe no lugar e fecha o espaço', () => {
    let d = comp.emptyComposition()
    const a = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 3 }); d = a.doc
    const b = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }); d = b.doc
    d = apply(d, { type: 'trimClip', clipId: a.createdId, in: 1, ripple: true }).doc
    assert.deepEqual([d.clips.find((c) => c.id === a.createdId).start, d.clips.find((c) => c.id === b.createdId).start], [0, 2])
  })
  await check('mover clipe para outra trilha desfaz a transição que dependia dele', () => {
    const { d, a, b } = twoWithTransition()
    const t = apply(d, { type: 'addTrack', kind: 'video' })
    const r = apply(t.doc, { type: 'moveClip', clipId: a, trackId: t.createdId, start: 0 }).doc
    assert.equal(r.clips.find((c) => c.id === b).transitionIn, null)
  })
  await check('transições que se cruzariam no clipe do meio são recusadas', () => {
    let d = comp.emptyComposition()
    d = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc
    const m = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 1 }); d = m.doc
    const z = apply(d, { type: 'addClip', mediaId: 'red', in: 0, out: 2 }); d = z.doc
    d = apply(d, { type: 'setTransition', clipId: m.createdId, transition: { type: 'cross-dissolve', duration: 0.6 } }).doc
    assert.throws(() => apply(d, { type: 'setTransition', clipId: z.createdId, transition: { type: 'cross-dissolve', duration: 0.6 } }), /se sobrepõem/)
  })
  await check('espaço + corte seco + transição renderiza (base de tempo do xfade)', () => {
    let d = comp.emptyComposition()
    d = apply(d, { type: 'addClip', mediaId: 'red', start: 0.5, in: 0, out: 1 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 1 }).doc
    const c = apply(d, { type: 'addClip', mediaId: 'red', in: 1, out: 2.5 }); d = c.doc
    d = apply(d, { type: 'setTransition', clipId: c.createdId, transition: { type: 'slide-left', duration: 0.5 } }).doc
    const out = render(d, 'gap-cut-xfade.mp4')
    assert.ok(Math.abs(Number(probe(out).format.duration) - comp.compositionDuration(d)) < 0.1)
  })
  await check('durações fora da grade de quadros não acumulam atraso', () => {
    let d = comp.emptyComposition()
    for (let i = 0; i < 12; i++) d = apply(d, { type: 'addClip', mediaId: i % 2 ? 'blue' : 'red', in: 0, out: 0.517 }).doc
    const out = render(d, 'drift.mp4', { w: 160, h: 90, fps: 30 })
    const last = d.clips.at(-1)
    const t = last.start + 0.25
    const col = colorAt(out, t); assert.ok(col[2] > 150 && col[0] < 80, `azul esperado em ${t.toFixed(2)} s, veio ${col}`)
    assert.ok(Math.abs(Number(probe(out).format.duration) - 6.2) < 0.1)
  })
  await check('clipes de arquivos removidos saem da composição', () => {
    const { d } = twoWithTransition()
    const media2 = new Map([...media].filter(([k]) => k !== 'red'))
    const r = comp.pruneMissingMedia(d, media2)
    assert.equal(r.removed, 1); assert.equal(r.doc.clips[0].transitionIn, null)
  })
  // 6) Fase 3: enquadramento, keyframes, cor, áudio e mixagem.
  const one = (mediaId, out = 2) => { const a = apply(comp.emptyComposition(), { type: 'addClip', mediaId, in: 0, out }); return [a.doc, a.createdId] }
  await check('zoom 2× ancorado à esquerda mostra só a metade vermelha', () => {
    const [d, c] = one('split')
    const out = render(apply(d, { type: 'setTransform', clipId: c, transform: { zoom: 2, anchorX: 0, anchorY: 0.5 } }).doc, 'zoom.mp4', { w: 320, h: 180, fps: 30 })
    const right = colorIn(out, 1, 260, 60, 40, 40); assert.ok(right[0] > 150 && right[2] < 80, `vermelho à direita esperado, veio ${right}`)
  })
  await check('zoom animado: começa inteiro e termina dentro do vermelho', () => {
    const [d, c] = one('split')
    let x = apply(d, { type: 'setTransform', clipId: c, transform: { anchorX: 0 } }).doc
    x = apply(x, { type: 'setKeyframes', clipId: c, prop: 'zoom', keyframes: [{ t: 0, v: 1, ease: 'linear' }, { t: 1.5, v: 2, ease: 'inOut' }] }).doc
    const out = render(x, 'zoom-kf.mp4')
    const startRight = colorIn(out, 0.05, 260, 60, 40, 40); assert.ok(startRight[2] > 150, `azul à direita no início, veio ${startRight}`)
    const endRight = colorIn(out, 1.8, 260, 60, 40, 40); assert.ok(endRight[0] > 150 && endRight[2] < 80, `vermelho à direita no fim, veio ${endRight}`)
  })
  await check('picture-in-picture: metade do tamanho, deslocado para a direita', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    const t = apply(d, { type: 'addTrack', kind: 'video' }); d = t.doc
    const p = apply(d, { type: 'addClip', mediaId: 'red', trackId: t.createdId, in: 0, out: 2 }); d = p.doc
    d = apply(d, { type: 'setTransform', clipId: p.createdId, transform: { scale: 0.5, x: 0.25 } }).doc
    const out = render(d, 'pip.mp4')
    const pip = colorIn(out, 1, 220, 80, 20, 20); assert.ok(pip[0] > 150 && pip[2] < 80, `vermelho no PiP, veio ${pip}`)
    const left = colorIn(out, 1, 20, 80, 20, 20); assert.ok(left[2] > 150 && left[0] < 80, `azul fora do PiP, veio ${left}`)
  })
  await check('posição animada: entra pela esquerda até o centro', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    const t = apply(d, { type: 'addTrack', kind: 'video' }); d = t.doc
    const p = apply(d, { type: 'addClip', mediaId: 'red', trackId: t.createdId, in: 0, out: 2 }); d = p.doc
    d = apply(d, { type: 'setKeyframes', clipId: p.createdId, prop: 'x', keyframes: [{ t: 0, v: -1, ease: 'out' }, { t: 1, v: 0, ease: 'linear' }] }).doc
    const out = render(d, 'slide-in.mp4')
    const early = colorAt(out, 0.02); assert.ok(early[2] > 150 && early[0] < 60, `azul no início, veio ${early}`)
    const late = colorAt(out, 1.5); assert.ok(late[0] > 150 && late[2] < 60, `vermelho no fim, veio ${late}`)
  })
  await check('rotação de 180° troca os lados da imagem', () => {
    const [d, c] = one('split')
    const out = render(apply(d, { type: 'setTransform', clipId: c, transform: { rotation: 180 } }).doc, 'rot.mp4')
    const left = colorIn(out, 1, 20, 60, 40, 40); assert.ok(left[2] > 150 && left[0] < 80, `azul à esquerda após girar, veio ${left}`)
  })
  await check('opacidade animada: some do preto até o vermelho', () => {
    const [d, c] = one('red')
    const out = render(apply(d, { type: 'setKeyframes', clipId: c, prop: 'opacity', keyframes: [{ t: 0, v: 0, ease: 'linear' }, { t: 1, v: 1, ease: 'linear' }] }).doc, 'op-kf.mp4')
    const a = colorAt(out, 0.05); const b = colorAt(out, 0.5); const e = colorAt(out, 1.5)
    assert.ok(a[0] < 40 && b[0] > 60 && b[0] < 200 && e[0] > 200, `esperado escuro→médio→vermelho, veio ${a} / ${b} / ${e}`)
  })
  await check('brilho e desfoque animados renderizam', () => {
    const [d, c] = one('split')
    let x = apply(d, { type: 'setKeyframes', clipId: c, prop: 'brightness', keyframes: [{ t: 0, v: -0.8, ease: 'linear' }, { t: 1.5, v: 0, ease: 'linear' }] }).doc
    x = apply(x, { type: 'setKeyframes', clipId: c, prop: 'blur', keyframes: [{ t: 0, v: 20, ease: 'linear' }, { t: 1, v: 0, ease: 'linear' }] }).doc
    const out = render(x, 'eq-blur.mp4')
    assert.ok(colorAt(out, 0.05)[0] < colorAt(out, 1.8)[0] - 40, 'deveria clarear ao longo do clipe')
    const edgeEarly = colorIn(out, 0.05, 150, 80, 6, 20); const edgeLate = colorIn(out, 1.8, 150, 80, 6, 20)
    assert.ok(edgeLate[2] < edgeEarly[2] - 20, `o lado vermelho perto da borda deveria perder o azul borrado: ${edgeEarly} → ${edgeLate}`)
  })
  await check('LUT da biblioteca é aplicada (inverte vermelho em ciano)', () => {
    const [d, c] = one('red', 1)
    const out = render(apply(d, { type: 'addEffect', clipId: c, effect: 'lut', asset: 'inverte' }).doc, 'lut.mp4')
    const x = colorAt(out, 0.5); assert.ok(x[0] < 80 && x[1] > 150 && x[2] > 150, `ciano esperado, veio ${x}`)
    assert.throws(() => render(apply(d, { type: 'addEffect', clipId: c, effect: 'lut', asset: 'nao-existe' }).doc, 'lut2.mp4'), /não está na biblioteca/)
  })
  await check('volume animado: começa mudo e termina alto', () => {
    const [d, c] = one('voice', 3)
    const out = render(apply(d, { type: 'setKeyframes', clipId: c, prop: 'volume', keyframes: [{ t: 0, v: 0, ease: 'linear' }, { t: 1.5, v: 1, ease: 'linear' }] }).doc, 'vol-kf.mp4')
    assert.ok(meanVolume(out, 0, 0.3) < meanVolume(out, 2, 0.8) - 15, 'o começo deveria ser bem mais baixo')
  })
  await check('ducking abaixa a música enquanto o vídeo tem som', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 3 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'music', in: 0, out: 3 }).doc
    const plain = render(d, 'noduck.mp4')
    const ducked = render(apply(d, { type: 'setMix', mix: { duck: true, duckAmount: 1 } }).doc, 'duck.mp4')
    // Mede só a música (880 Hz) com um passa-banda.
    const band = (f) => { const r = spawnSync(ffmpeg, ['-hide_banner', '-ss', '1', '-t', '1.5', '-i', f, '-af', 'bandpass=f=880:width_type=q:w=8,volumedetect', '-f', 'null', '-']); return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr.toString())[1]) }
    assert.ok(band(ducked) < band(plain) - 4, `música deveria abaixar: ${band(plain)} → ${band(ducked)} dB`)
  })
  await check('normalização final chega perto do alvo (-14 LUFS)', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'voice', in: 0, out: 8 }).doc
    const c = d.clips[0].id
    d = apply(d, { type: 'setClipProps', clipId: c, volume: 0.2 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', trackId: 'V1', in: 0, out: 4 }).doc
    const out = render(apply(d, { type: 'setMix', mix: { normalize: true, targetLufs: -14 } }).doc, 'norm.mp4')
    const i = integrated(out); assert.ok(i !== null && Math.abs(i + 14) < 2, `loudness ${i}`)
    // Som com estalos fortes (tiros), normalizado e em AAC: o pico real fica ≤ -1 dBTP.
    const shots = join(dir, 'shots.m4a')
    ff('-f', 'lavfi', '-i', "aevalsrc='0.05*sin(2*PI*180*t)+0.95*exp(-(mod(t,1.3))*35)*(random(0)*2-1)':s=44100:d=8", '-c:a', 'aac', shots)
    media.set('shots', { id: 'shots', kind: 'audio', duration: 8, hasAudio: true, path: shots })
    let s2 = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'shots', in: 0, out: 8 }).doc
    s2 = apply(s2, { type: 'addClip', mediaId: 'blue', trackId: 'V1', in: 0, out: 4 }).doc
    const peaky = render(apply(s2, { type: 'setMix', mix: { normalize: true, targetLufs: -14 } }).doc, 'norm-peaks.mp4')
    const m = qc.parseQcLog(spawnSync(ffmpeg, qc.qcAnalysisArgs(peaky, true)).stderr.toString())
    assert.ok(m.truePeak !== null && m.truePeak <= -1, `pico real ${m.truePeak} dBTP`)
  })
  await check('dividir preserva a animação no ponto do corte', () => {
    const [d, c] = one('red', 2)
    let x = apply(d, { type: 'setKeyframes', clipId: c, prop: 'opacity', keyframes: [{ t: 0, v: 0, ease: 'linear' }, { t: 2, v: 1, ease: 'linear' }] }).doc
    x = apply(x, { type: 'splitClip', clipId: c, at: 1 }).doc
    const [l, r2] = comp.trackClips(x, 'V1')
    assert.deepEqual(l.keyframes.opacity.map((k) => [k.t, k.v]), [[0, 0], [1, 0.5]])
    assert.deepEqual(r2.keyframes.opacity.map((k) => [k.t, k.v]), [[0, 0.5], [1, 1]])
  })
  await check('cortar o início desloca os keyframes junto com o conteúdo', () => {
    const [d, c] = one('red', 3)
    let x = apply(d, { type: 'setKeyframes', clipId: c, prop: 'zoom', keyframes: [{ t: 0.5, v: 1, ease: 'linear' }, { t: 2.5, v: 2, ease: 'linear' }] }).doc
    x = apply(x, { type: 'trimClip', clipId: c, in: 1 }).doc
    // O começo cortado vira um keyframe no zero com o valor interpolado (1,25): a curva visível não muda.
    assert.deepEqual(x.clips[0].keyframes.zoom.map((k) => [k.t, k.v]), [[0, 1.25], [1.5, 2]])
  })
  await check('colar efeitos e animação em outro clipe', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 1 }).doc
    const b = apply(d, { type: 'addClip', mediaId: 'blue', in: 0, out: 1 }); d = b.doc
    const a = d.clips[0].id
    d = apply(d, { type: 'addEffect', clipId: a, effect: 'vignette' }).doc
    d = apply(d, { type: 'setKeyframes', clipId: a, prop: 'zoom', keyframes: [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 1.5, ease: 'linear' }] }).doc
    d = apply(d, { type: 'pasteAttributes', fromClipId: a, toClipIds: [b.createdId], keyframes: true }).doc
    const target = d.clips.find((x) => x.id === b.createdId)
    assert.equal(target.effects[0].type, 'vignette'); assert.equal(target.keyframes.zoom.length, 2)
    assert.notEqual(target.effects[0].id, d.clips[0].effects[0].id)
  })
  await check('efeito de áudio recusado em clipe sem som e propriedade inválida recusada', () => {
    const [d, c] = one('blue', 1)
    assert.throws(() => apply(d, { type: 'addEffect', clipId: c, effect: 'denoise' }), /precisa de um clipe com som/)
    assert.throws(() => apply(d, { type: 'setKeyframes', clipId: c, prop: 'teletransporte', keyframes: [] }), /desconhecida/)
  })
  await check('migração lê documento antigo e recusa versão futura', () => {
    const doc1 = comp.migrateComposition({ version: 1, tracks: [{ id: 'V1', kind: 'video' }], clips: [{ id: 'x', trackId: 'V1', mediaId: 'red', start: 0, in: 0, out: 1 }] })
    assert.equal(doc1.clips[0].volume, 1)
    assert.throws(() => comp.migrateComposition({ version: 99, tracks: [], clips: [] }), /mais nova/)
  })
  // Velocidade: vídeo vermelho nos 2 s iniciais e azul nos 2 s finais, com tom contínuo.
  const rb = join(dir, 'redblue.mp4')
  ff('-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', rb)
  media.set('rb', { id: 'rb', kind: 'video', duration: 4, hasAudio: true, path: rb })
  const isRed = (x) => x[0] > 150 && x[2] < 80
  const isBlue = (x) => x[2] > 150 && x[0] < 80
  await check('câmera lenta 0,5×: dobra a duração, imagem e som esticados', () => {
    const [d, c] = one('rb', 4)
    const x = apply(d, { type: 'setSpeed', clipId: c, speed: 0.5 }).doc
    assert.equal(comp.clipLength(x.clips[0]), 8)
    const out = render(x, 'slow.mp4')
    assert.ok(Math.abs(Number(probe(out).format.duration) - 8) < 0.15, `duração ${probe(out).format.duration}`)
    assert.ok(isRed(colorAt(out, 3.5)), `vermelho esperado em 3,5 s (arquivo 1,75 s), veio ${colorAt(out, 3.5)}`)
    assert.ok(isBlue(colorAt(out, 4.5)), `azul esperado em 4,5 s, veio ${colorAt(out, 4.5)}`)
    assert.ok(meanVolume(out, 6, 1) > -30, 'o som deveria continuar até o fim')
  })
  await check('acelerar 2× reduz pela metade e empurra o clipe seguinte', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'rb', in: 0, out: 4 }).doc
    const c = d.clips[0].id
    d = apply(d, { type: 'addClip', mediaId: 'green', start: 4, out: 1 }).doc
    const x = apply(d, { type: 'setSpeed', clipId: c, speed: 2 }).doc
    assert.equal(x.clips.find((k) => k.mediaId === 'green').start, 2)
    const out = render(x, 'fast.mp4')
    assert.ok(Math.abs(Number(probe(out).format.duration) - 3) < 0.15, `duração ${probe(out).format.duration}`)
    assert.ok(isRed(colorAt(out, 0.8)) && isBlue(colorAt(out, 1.3)), 'a troca de cor deveria acontecer em 1 s')
    assert.ok(meanVolume(out, 0.2, 1.5) > -30, 'o som acelerado deveria tocar')
  })
  await check('speed ramp divide o clipe em degraus e mantém a sequência contínua', () => {
    const [d, c] = one('rb', 4)
    const x = apply(d, { type: 'speedRamp', clipId: c, from: 1, to: 3, speed: 0.5 }).doc
    const parts = comp.trackClips(x, 'V1')
    assert.equal(parts.length, 9)
    for (let i = 1; i < parts.length; i++) {
      assert.ok(Math.abs(comp.clipEnd(parts[i - 1]) - parts[i].start) < 0.002, 'pedaços contíguos na timeline')
      assert.ok(Math.abs(parts[i - 1].out - parts[i].in) < 0.002, 'pedaços contíguos no arquivo')
    }
    const total = comp.clipEnd(parts.at(-1))
    assert.ok(total > 5 && total < 6, `duração ${total}`)
    const out = render(x, 'ramp.mp4')
    assert.ok(Math.abs(Number(probe(out).format.duration) - total) < 0.2, `duração ${probe(out).format.duration} vs ${total}`)
    assert.ok(isRed(colorAt(out, 0.5)) && isBlue(colorAt(out, total - 0.3)), 'começa vermelho e termina azul')
  })
  await check('freeze frame congela a imagem, silencia e empurra o resto', () => {
    const [d, c] = one('rb', 4)
    const r1 = apply(d, { type: 'freezeFrame', clipId: c, at: 1.9, duration: 2 })
    const parts = comp.trackClips(r1.doc, 'V1')
    assert.equal(parts.length, 3); assert.equal(parts[1].id, r1.createdId); assert.equal(comp.clipEnd(parts[2]), 6)
    const out = render(r1.doc, 'freeze.mp4')
    assert.ok(isRed(colorAt(out, 3.5)), `vermelho congelado esperado em 3,5 s, veio ${colorAt(out, 3.5)}`)
    assert.ok(isBlue(colorAt(out, 5)), `azul esperado depois do freeze, veio ${colorAt(out, 5)}`)
    assert.ok(meanVolume(out, 2.3, 1.2) < -50, 'o freeze deveria ser mudo')
    assert.ok(meanVolume(out, 4.5, 1) > -30, 'o som volta depois do freeze')
    assert.throws(() => apply(r1.doc, { type: 'setSpeed', clipId: r1.createdId, speed: 2 }), /Freeze/)
  })
  await check('prévia exata de um trecho em câmera lenta lê o ponto certo do arquivo', () => {
    const [d, c] = one('rb', 4)
    const x = slice.sliceComposition(apply(d, { type: 'setSpeed', clipId: c, speed: 0.5 }).doc, 3, 5)
    assert.deepEqual([x.clips[0].in, x.clips[0].out, comp.clipLength(x.clips[0])], [1.5, 2.5, 2])
    const out = render(x, 'slice-slow.mp4')
    assert.ok(isRed(colorAt(out, 0.4)) && isBlue(colorAt(out, 1.4)), 'troca de cor no meio do trecho')
  })
  await check('rampa curta e rápida usa menos degraus em vez de falhar', () => {
    const [d, c] = one('rb', 4)
    const x = apply(d, { type: 'speedRamp', clipId: c, from: 2, to: 3, speed: 4 }).doc
    assert.ok(comp.trackClips(x, 'V1').every((p) => comp.clipLength(p) >= comp.MIN_CLIP - 0.001))
    assert.throws(() => apply(d, { type: 'speedRamp', clipId: c, from: 2, to: 2.3, speed: 8 }), /curto demais/)
  })
  await check('rampa, corte e velocidade preservam a animação', () => {
    const [d, c] = one('rb', 4)
    const kf = apply(d, { type: 'setKeyframes', clipId: c, prop: 'opacity', keyframes: [{ t: 0, v: 0, ease: 'linear' }, { t: 4, v: 1, ease: 'linear' }] }).doc
    const ramp = apply(kf, { type: 'speedRamp', clipId: c, from: 1, to: 2, speed: 0.5 }).doc
    const parts = comp.trackClips(ramp, 'V1')
    assert.ok(parts.every((p) => p.keyframes.opacity?.length), 'todos os pedaços mantêm a opacidade')
    assert.ok(Math.abs(parts.at(-1).keyframes.opacity.at(-1).v - 1) < 0.01, 'termina opaco')
    const trimmed = apply(kf, { type: 'trimClip', clipId: c, in: 2, ripple: true }).doc
    assert.deepEqual(trimmed.clips[0].keyframes.opacity.map((k) => [k.t, k.v]), [[0, 0.5], [2, 1]])
    const slow = apply(kf, { type: 'setSpeed', clipId: c, speed: 0.5 }).doc
    assert.deepEqual(slow.clips[0].keyframes.opacity.map((k) => k.t), [0, 8])
  })
  await check('freeze guarda os valores animados e não desloca o resto do clipe', () => {
    let [d, c] = one('rb', 4)
    d = apply(d, { type: 'setKeyframes', clipId: c, prop: 'x', keyframes: [{ t: 0, v: 0, ease: 'linear' }, { t: 4, v: 1, ease: 'linear' }] }).doc
    const r1 = apply(d, { type: 'freezeFrame', clipId: c, at: 2, duration: 1 })
    const fz = r1.doc.clips.find((k) => k.id === r1.createdId)
    assert.deepEqual(fz.keyframes.x.map((k) => k.v), [0.5])
    let [s, sc] = one('rb', 0.1)
    s = apply(s, { type: 'setSpeed', clipId: sc, speed: 0.1 }).doc
    const parts = comp.trackClips(apply(s, { type: 'freezeFrame', clipId: sc, at: 0.8, duration: 1 }).doc, 'V1')
    assert.ok(Math.abs(comp.clipEnd(parts[0]) - 0.8) < 0.002 && Math.abs(comp.clipEnd(parts.at(-1)) - 2) < 0.002, `fim ${comp.clipEnd(parts.at(-1))}`)
  })
  await check('freeze com posição animada anda no render', () => {
    const [d, c] = one('rb', 4)
    const r1 = apply(d, { type: 'freezeFrame', clipId: c, at: 3, duration: 2 })
    // O quadro congelado (azul) entra pela esquerda: fora da tela no início do freeze, centralizado no fim.
    const x = apply(r1.doc, { type: 'setKeyframes', clipId: r1.createdId, prop: 'x', keyframes: [{ t: 0, v: -1, ease: 'linear' }, { t: 2, v: 0, ease: 'linear' }] }).doc
    const out = render(x, 'freeze-move.mp4')
    const early = colorAt(out, 3.1), late = colorAt(out, 4.9)
    assert.ok(early[2] < 60, `quase fora da tela no começo, veio ${early}`)
    assert.ok(isBlue(late), `azul centralizado no fim, veio ${late}`)
  })
  await check('cortar o início sem ripple não passa do zero da timeline', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'rb', start: 1, in: 2, out: 4 }).doc
    const c = d.clips[0].id
    d = apply(d, { type: 'setSpeed', clipId: c, speed: 2 }).doc
    const x = apply(d, { type: 'trimClip', clipId: c, in: 0 }).doc.clips[0]
    assert.deepEqual([x.start, x.in, comp.clipEnd(x)], [0, 0, 2])
  })
  await check('prévia exata começando no meio de uma transição volta para o início dela', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 4 }).doc
    const b = apply(d, { type: 'addClip', mediaId: 'blue', start: 4, in: 0, out: 4 }); d = b.doc
    d = apply(d, { type: 'setTransition', clipId: b.createdId, transition: { type: 'cross-dissolve', duration: 1 } }).doc
    const tb = d.clips.find((k) => k.id === b.createdId).start
    assert.equal(slice.safeSliceStart(d, tb + 0.5), tb)
    assert.equal(slice.safeSliceStart(d, 1), 1)
    const part = slice.sliceComposition(d, slice.safeSliceStart(d, tb + 0.5), tb + 2)
    assert.ok(part.clips.find((k) => k.mediaId === 'blue').transitionIn, 'a transição continua no recorte')
  })
  await check('slip troca o trecho do arquivo sem mexer na timeline', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'rb', start: 1, in: 0.5, out: 1.5 }).doc
    const c = d.clips[0].id
    const x = apply(d, { type: 'slipClip', clipId: c, delta: 2 }).doc.clips[0]
    assert.deepEqual([x.start, x.in, x.out], [1, 2.5, 3.5])
    const y = apply(d, { type: 'slipClip', clipId: c, delta: 10 }).doc.clips[0]
    assert.deepEqual([y.in, y.out], [3, 4], 'não passa do fim do arquivo')
    assert.ok(isBlue(colorAt(render(apply(d, { type: 'slipClip', clipId: c, delta: 2 }).doc, 'slip.mp4'), 1.5)))
  })
  await check('grupo se move junto; a rampa já nasce agrupada', () => {
    const [d, c] = one('rb', 4)
    const ramp = apply(d, { type: 'speedRamp', clipId: c, from: 1, to: 2, speed: 0.5 }).doc
    const parts = comp.trackClips(ramp, 'V1')
    assert.ok(parts[0].group && parts.every((p) => p.group === parts[0].group))
    const moved = apply(ramp, { type: 'moveClip', clipId: parts[3].id, start: parts[3].start + 2 }).doc
    const after = comp.trackClips(moved, 'V1')
    assert.ok(after.every((p, i) => Math.abs(p.start - parts[i].start - 2) < 0.002), 'todos andaram 2 s')
    const un = apply(moved, { type: 'ungroupClips', clipIds: [after[0].id] }).doc
    assert.ok(un.clips.every((p) => !p.group))
    let g = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 1 }).doc
    g = apply(g, { type: 'addClip', mediaId: 'music', in: 0, out: 1 }).doc
    const gr = apply(g, { type: 'groupClips', clipIds: g.clips.map((k) => k.id) })
    assert.ok(gr.createdId && gr.doc.clips.every((k) => k.group === gr.createdId))
    const mv = apply(gr.doc, { type: 'moveClip', clipId: gr.doc.clips[0].id, start: 3 }).doc
    assert.ok(mv.clips.every((k) => k.start === 3), 'vídeo e música do grupo andaram juntos')
    const v2 = apply(gr.doc, { type: 'addTrack', kind: 'video' })
    assert.throws(() => apply(v2.doc, { type: 'moveClip', clipId: gr.doc.clips[0].id, start: 0, trackId: v2.createdId }), /trilhas diferentes/)
  })
  await check('máscara elíptica recorta o clipe de cima e mostra a trilha de baixo', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    const v2 = apply(d, { type: 'addTrack', kind: 'video' }); d = v2.doc
    const top = apply(d, { type: 'addClip', mediaId: 'red', trackId: v2.createdId, start: 0, in: 0, out: 2 }); d = top.doc
    const masked = apply(d, { type: 'addEffect', clipId: top.createdId, effect: 'mask', params: { w: 0.5, h: 0.5, feather: 0.02 } }).doc
    const t0 = Date.now()
    const out = render(masked, 'mask.mp4')
    const ms = Date.now() - t0
    const mid = colorIn(out, 1, 150, 80, 20, 20), corner = colorIn(out, 1, 45, 5, 12, 12)
    assert.ok(isRed(mid), `vermelho no centro, veio ${mid}`)
    assert.ok(isBlue(corner), `azul no canto, veio ${corner}`)
    const inv = render(apply(d, { type: 'addEffect', clipId: top.createdId, effect: 'mask', params: { w: 0.5, h: 0.5, invert: 1, shape: 1 } }).doc, 'mask-inv.mp4')
    const im = colorIn(inv, 1, 150, 80, 20, 20), ic = colorIn(inv, 1, 45, 5, 12, 12)
    assert.ok(isBlue(im) && isRed(ic), `invertida troca dentro e fora: centro ${im}, canto ${ic}`)
    console.log(`   (máscara: ${ms} ms para 2 s em 320x180)`)
  })
  await check('curvas mudam o tom (branco a 0,5 escurece o vermelho)', () => {
    const [d, c] = one('red', 1)
    const out = render(apply(d, { type: 'addEffect', clipId: c, effect: 'curves', params: { p100: 0.5, p75: 0.375, p50: 0.25, p25: 0.125 } }).doc, 'curves.mp4')
    const x = colorAt(out, 0.5); assert.ok(x[0] > 90 && x[0] < 160, `vermelho pela metade, veio ${x}`)
  })
  /** Fração de pixels claros (texto branco) numa região. */
  const brightShare = (file, t, x, y, w, h) => {
    const buf = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-'])
    return buf.filter((v) => v > 200).length / buf.length
  }
  await check('título: texto centralizado, alinhado à esquerda e com caixa de fundo', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    const t = apply(d, { type: 'addTitle', start: 0, duration: 2, title: { text: 'TESTE', size: 0.2, shadow: 0 } })
    assert.ok(t.doc.tracks.length === 3 && t.doc.clips.find((c) => c.id === t.createdId).trackId !== 'V1', 'título vai numa trilha nova acima')
    const out = render(t.doc, 'title.mp4')
    assert.ok(brightShare(out, 1, 110, 70, 100, 40) > 0.15, 'texto branco no centro')
    assert.ok(brightShare(out, 1, 0, 0, 60, 60) < 0.01, 'canto sem texto')
    const left = apply(t.doc, { type: 'updateTitle', clipId: t.createdId, title: { align: 'left', x: 0.02 } }).doc
    const lo = render(left, 'title-left.mp4')
    assert.ok(brightShare(lo, 1, 5, 70, 60, 40) > 0.1 && brightShare(lo, 1, 250, 70, 60, 40) < 0.02, 'alinhado à esquerda')
    const boxed = render(apply(t.doc, { type: 'updateTitle', clipId: t.createdId, title: { box: 1, boxColor: '#ff0000', text: 'a' } }).doc, 'title-box.mp4')
    assert.ok(isRed(colorIn(boxed, 1, 150, 80, 6, 6)) || isRed(colorIn(boxed, 1, 140, 75, 6, 6)), 'caixa vermelha atrás do texto')
  })
  await check('título automático não cai em trilha oculta ou com mesclagem', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', in: 0, out: 2 }).doc
    const v2 = apply(d, { type: 'addTrack', kind: 'video' }); d = v2.doc
    d = apply(d, { type: 'updateTrack', trackId: v2.createdId, blend: 'multiply' }).doc
    const t = apply(d, { type: 'addTitle', duration: 1, title: { text: 'oi' } })
    assert.notEqual(t.doc.clips.find((c) => c.id === t.createdId).trackId, v2.createdId)
    assert.ok(comp.ASSET_ID.test('meu-pack.fonte') && !comp.ASSET_ID.test('a.b.c') && !comp.ASSET_ID.test('../x'))
  })
  await check('título com caracteres especiais e duas linhas renderiza (escape do drawtext)', () => {
    const d = apply(comp.emptyComposition(), { type: 'addTitle', duration: 1, title: { text: "It's: 50% [ok], a;b \\ \"x\" {%n}\nsegunda linha", font: 'anton', size: 0.1 } }).doc
    const out = render(d, 'title-esc.mp4')
    assert.ok(brightShare(out, 0.5, 0, 40, 320, 50) > 0.03 && brightShare(out, 0.5, 0, 95, 320, 45) > 0.03, 'duas linhas visíveis')
    assert.throws(() => apply(d, { type: 'updateTitle', clipId: 'nao-existe', title: {} }), /não encontrado/)
  })
  await check('título usa a fonte padrão quando a escolhida não está instalada', () => {
    const d = apply(comp.emptyComposition(), { type: 'addTitle', duration: 1, title: { text: 'X', font: 'fonte-que-nao-existe' } }).doc
    render(d, 'title-fallback.mp4')
  })
  await check('mesclagem screen clareia sem mexer onde a trilha é transparente', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc
    const v2 = apply(d, { type: 'addTrack', kind: 'video' }); d = v2.doc
    const top = apply(d, { type: 'addClip', mediaId: 'green', trackId: v2.createdId, start: 0, out: 1 }); d = top.doc
    d = apply(d, { type: 'setTransform', clipId: top.createdId, transform: { scale: 0.5 } }).doc
    const normal = render(d, 'blend-normal.mp4')
    const screen = render(apply(d, { type: 'updateTrack', trackId: v2.createdId, blend: 'screen' }).doc, 'blend-screen.mp4')
    const n = colorIn(normal, 0.5, 150, 80, 20, 20), s = colorIn(screen, 0.5, 150, 80, 20, 20)
    assert.ok(n[0] < 80 && n[1] > 150, `normal: verde por cima, veio ${n}`)
    assert.ok(s[0] > 200 && s[1] > 200, `screen: vermelho + verde = amarelo, veio ${s}`)
    assert.ok(isRed(colorIn(screen, 0.5, 50, 5, 15, 15)), 'fora da imagem continua vermelho')
    assert.ok(isRed(colorIn(screen, 1.5, 150, 80, 20, 20)), 'depois do fim do overlay continua vermelho')
    assert.throws(() => apply(d, { type: 'updateTrack', trackId: v2.createdId, blend: 'xor' }), /desconhecido/)
  })
  // ---------- Auto Studio ----------
  const fakeAnalysis = (mediaId, duration, seed) => {
    const n = Math.round(duration / 0.5)
    const energy = Array.from({ length: n }, (_, i) => -30 + 20 * Math.abs(Math.sin(i * 0.7 + seed)))
    return { version: 1, mediaId, duration, scenes: [1.5, 3], motion: Array.from({ length: n }, (_, i) => (i % 3) / 3), black: [], silences: [{ start: 1, end: 1.6 }],
      loudness: { integrated: -18, truePeak: -2, range: 5 }, energy, transients: [0.8, 2.2, 3.1], clippingRisk: false, music: null, musicAnalyzed: false, analyzedAt: 0 }
  }
  const runPlan = (plan) => {
    let d = comp.emptyComposition()
    const created = []
    for (const c of plan.commands) { const r = apply(d, comp.resolveRefs(c, created)); d = r.doc; created.push(r.createdId) }
    comp.validateComposition(d, media)
    return d
  }
  await check('Auto Studio: os 4 estilos geram edições válidas (refs "$N" resolvidas)', async () => {
    const zoom = { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [{ t: 0, v: 1, ease: 'linear' }, { t: 0.07, v: 1.18, ease: 'out' }, { t: 0.35, v: 1, ease: 'out' }] } }
    const look = { kind: 'look', effects: [{ type: 'vignette', params: { strength: 0.4 } }] }
    const intro = { style: { text: 'X', font: 'anton', size: 0.1 }, duration: 1.5, fadeIn: 0, fadeOut: 0.2, keyframes: { zoom: [{ t: 0, v: 1.3, ease: 'out' }, { t: 0.2, v: 1, ease: 'out' }] } }
    const videos = [fakeAnalysis('red', 4, 0), fakeAnalysis('rb', 4, 1)]
    const beats = Array.from({ length: 40 }, (_, i) => +(0.25 + i * 0.5).toFixed(3))
    for (const style of ['gaming', 'shorts', 'vlog', 'cinema']) {
      const plan = auto.planAutoEdit({ style, videos, music: style === 'vlog' ? null : { mediaId: 'music', duration: 10, beats, bpm: 120 }, targetDuration: 8, title: 'Minha jogada',
        assets: { intro, look, cutMotion: zoom, accent: zoom, drift: [zoom], whooshId: 'voice', whooshLength: 0.5 } })
      const d = runPlan(plan)
      assert.ok(plan.clips >= 2 && d.clips.filter((c) => c.trackId === 'V1').length === plan.clips, `${style}: clipes no V1`)
      assert.ok(plan.duration <= 8.01, `${style}: respeita a duração (${plan.duration})`)
      assert.ok(d.clips.some((c) => c.title?.text === 'Minha jogada'), `${style}: título de abertura`)
      assert.ok(d.mix.normalize, `${style}: normaliza`)
      if (style !== 'vlog') {
        const v = comp.trackClips(d, 'V1')
        // Com música, todo corte cai numa batida (meio segundo).
        for (const c of v) assert.ok(Math.abs(((c.start * 2) % 1 + 1) % 1) < 0.01 || Math.abs(((c.start * 2) % 1) - 1) < 0.01, `${style}: corte fora da batida em ${c.start}`)
      }
      if (style === 'gaming') {
        assert.ok(d.clips.some((c) => c.keyframes.zoom?.length), 'gaming: zoom punch nos cortes')
        assert.ok(d.tracks.some((t) => t.name === 'Efeitos sonoros') && d.clips.some((c) => c.mediaId === 'voice'), 'gaming: whoosh numa trilha própria')
        const out = render(d, 'auto-gaming.mp4')
        assert.ok(Math.abs(Number(probe(out).format.duration) - plan.duration) < 0.3, `duração do render ${probe(out).format.duration}`)
      }
      if (style === 'cinema') assert.ok(d.clips.every((c) => c.mediaId === 'music' || c.title || c.effects.some((e) => e.type === 'letterbox')), 'cinema: barras de cinema')
    }
    assert.throws(() => comp.resolveRefs({ type: 'removeClip', clipId: '$5' }, ['a']), /ainda não rodou/)
    // Cinema sem música com último trecho curto: dissolves cabem (ou viram corte seco).
    for (const target of [9.5, 10, 10.5, 11]) runPlan(auto.planAutoEdit({ style: 'cinema', videos, music: null, targetDuration: target, assets: {} }))
    // Vlog com música: a música entra baixa, do tamanho da edição.
    const vlog = runPlan(auto.planAutoEdit({ style: 'vlog', videos, music: { mediaId: 'music', duration: 10, beats, bpm: 120 }, targetDuration: 6, assets: {} }))
    const mus = vlog.clips.find((c) => c.mediaId === 'music')
    assert.ok(mus && mus.volume < 0.5 && mus.out <= 6.01, 'vlog: música de fundo')
    // Preset cortado no fim do clipe guarda o valor interpolado.
    const cut = auto.presetToCommands({ kind: 'motion', keyframes: { zoom: [{ t: 0, v: 1, ease: 'linear' }, { t: 1, v: 1.2, ease: 'linear' }] } }, 'c', 2, 1.5)
    assert.deepEqual(cut[0].keyframes.map((k) => [k.t, k.v]), [[1.5, 1], [2, 1.1]])
  })
  // ---------- Quality Check ----------
  await check('Quality Check da timeline: tela preta, piscada, área segura do Shorts, mudo, duração; correções resolvem', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', start: 0, in: 0, out: 2 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', start: 3, in: 0, out: 2 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', start: 5, in: 2, out: 2.1 }).doc
    const t = apply(d, { type: 'addTitle', start: 0, duration: 2, title: { text: 'Inscreva-se', y: 0.92, size: 0.05 } }); d = t.doc
    const shorts = presets.exportPresetById('shorts')
    const ctx = { media, fonts: new Set(['poppins-bold']), luts: new Set(), preset: { ...shorts, maxDuration: 4 } }
    const items = qc.checkComposition(d, ctx)
    const codes = items.map((i) => i.code)
    for (const c of ['tela-preta', 'clipe-curto', 'area-segura', 'sem-som', 'longo-demais']) assert.ok(codes.includes(c), `deveria acusar ${c}: ${codes}`)
    assert.equal(items[0].level, 'erro', 'erros primeiro')
    // Aplica as correções (área segura + buraco + piscada) e verifica de novo.
    let fixed = d
    for (const code of ['area-segura', 'tela-preta']) for (const c of items.find((i) => i.code === code).fix) fixed = apply(fixed, c).doc
    const after = qc.checkComposition(fixed, { ...ctx, preset: shorts }).map((i) => i.code)
    assert.ok(!after.includes('area-segura') && !after.includes('tela-preta'), `corrigido: ${after}`)
    const ty = fixed.clips.find((c) => c.id === t.createdId).title.y
    assert.ok(ty + 0.05 * 1.15 / 2 <= 1 - shorts.safe.bottom + 0.001, `título acima da interface: ${ty}`)
    // Timeline 16:9 indo para Shorts com fundo desfocado: o título fica no meio do quadro vertical (sem aviso).
    const wide = { ...ctx, aspect: 16 / 9, preset: shorts }
    assert.ok(!qc.checkComposition(d, wide).some((i) => i.code === 'area-segura'), '16:9 dentro do 9:16 não fica sob a interface')
    const edge = apply(d, { type: 'updateTitle', clipId: t.createdId, title: { x: 0.08, y: 0.5, align: 'left' } }).doc
    const cropped = qc.checkComposition(edge, { ...wide, preset: { ...shorts, fit: 'crop' } }).find((i) => i.code === 'area-segura')
    assert.ok(cropped && /fora do quadro/.test(cropped.message), 'com corte, texto na borda sai do quadro')
    const voiced = qc.checkComposition(apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'red', in: 0, out: 2 }).doc, ctx).map((i) => i.code)
    assert.ok(voiced.includes('sem-normalizar') && !voiced.includes('sem-som'))
  })
  await check('Quality Check do arquivo: mede loudness, pico, pretos e imagem parada com o FFmpeg real', () => {
    // 1 s azul + 2 s preto + 3 s parado, com tom alto (pico perto de 0 dBFS).
    const f = join(dir, 'qc-src.mp4')
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=7:sample_rate=48000',
      '-filter_complex', '[2:v]trim=end_frame=1,loop=loop=89:size=1:start=0,setpts=N/30/TB[f];[0:v][1:v][f]concat=n=3:v=1:a=0[v];[3:a]volume=7.5[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f)
    const r = spawnSync(ffmpeg, qc.qcAnalysisArgs(f, true))
    const log = r.stderr.toString()
    const m = { duration: 6, width: 320, height: 180, bytes: 30 * 1048576, hasAudio: true, ...qc.parseQcLog(log) }
    assert.ok(m.black.some((b) => b.start > 0.8 && b.start < 1.2 && b.end > 2.8), `preto de 1 a 3 s: ${JSON.stringify(m.black)}`)
    assert.ok(m.freeze.some((x) => x.start > 2.8 && x.start < 3.4), `imagem parada a partir de 3 s: ${JSON.stringify(m.freeze)}`)
    assert.ok(m.integrated !== null && m.integrated > -12, `loudness alta: ${m.integrated}`)
    assert.ok(m.truePeak !== null && m.truePeak > -1, `pico: ${m.truePeak}`)
    const items = qc.checkRender(m, presets.exportPresetById('whatsapp')).map((i) => i.code)
    for (const c of ['preto', 'pico', 'loudness', 'tamanho', 'congelado']) assert.ok(items.includes(c), `deveria acusar ${c}: ${items}`)
    assert.ok(qc.checkRender(m, presets.exportPresetById('shorts')).some((i) => i.code === 'proporcao'), '16:9 não serve para Shorts')
  })
  await check('encaixe vertical: fundo desfocado e corte funcionam no -vf da fila de exportação', () => {
    const { w, h } = size.presetSize('9:16', 360)
    assert.deepEqual([w, h], [360, 640])
    for (const mode of ['pad', 'crop', 'blur']) {
      const out = join(dir, `fit-${mode}.mp4`)
      ff('-i', blue, '-t', '1', '-vf', size.fitModeFilter(w, h, mode) + ',format=yuv420p', '-c:v', 'libx264', out)
      const v = probe(out).streams.find((s) => s.codec_type === 'video')
      assert.deepEqual([v.width, v.height], [360, 640], mode)
      const top = colorIn(out, 0.5, 100, 20, 40, 40)
      if (mode === 'pad') assert.ok(top.every((x) => x < 30), `pad: barra preta, veio ${top}`)
      else assert.ok(top[2] > 100, `${mode}: imagem azul até o topo, veio ${top}`)
    }
  })
  await check('Quality Check: fechar buracos leva títulos/áudio junto, mantém transições, vários buracos e fim preto', () => {
    let d = apply(comp.emptyComposition(), { type: 'addClip', mediaId: 'blue', start: 0, in: 0, out: 2 }).doc
    d = apply(d, { type: 'addClip', mediaId: 'blue', start: 3, in: 0, out: 2 }).doc
    const c3 = apply(d, { type: 'addClip', mediaId: 'blue', start: 5, in: 0, out: 2 }); d = c3.doc
    d = apply(d, { type: 'setTransition', clipId: c3.createdId, transition: { type: 'cross-dissolve', duration: 0.5 } }).doc
    const t = apply(d, { type: 'addTitle', start: 3, duration: 1, title: { text: 'junto' } }); d = t.doc
    d = apply(d, { type: 'addClip', mediaId: 'music', start: 3, in: 0, out: 2 }).doc
    const ctx = { media, fonts: new Set(['poppins-bold']) }
    // Aplica uma correção por vez, verificando de novo (como o "Corrigir tudo").
    for (let i = 0; i < 10; i++) {
      const next = qc.checkComposition(d, ctx).find((x) => x.code === 'tela-preta' && x.fix)
      if (!next) break
      for (const c of next.fix) d = apply(d, c).doc
    }
    const v = comp.trackClips(d, 'V1')
    assert.deepEqual(v.map((c) => c.start), [0, 2, 3.5], `clipes encostados: ${v.map((c) => c.start)}`)
    assert.ok(v[2].transitionIn, 'transição mantida')
    assert.equal(d.clips.find((c) => c.id === t.createdId).start, 2, 'título andou junto')
    assert.equal(d.clips.find((c) => c.mediaId === 'music').start, 2, 'áudio andou junto')
    const tail = apply(d, { type: 'addClip', mediaId: 'music', start: 4, in: 0, out: 6 }).doc
    assert.ok(qc.checkComposition(tail, ctx).some((i) => i.code === 'tela-preta' && /final/.test(i.message)), 'fim sem imagem')
    // Texto que encolhe ao encaixar 16:9 no vertical.
    const small = apply(comp.emptyComposition(), { type: 'addTitle', duration: 1, title: { text: 'legenda', size: 0.06 } }).doc
    assert.ok(qc.checkComposition(small, { ...ctx, aspect: 16 / 9, preset: presets.exportPresetById('shorts') }).some((i) => i.code === 'texto-pequeno'))
    assert.ok(!qc.checkComposition(small, { ...ctx, aspect: 16 / 9, preset: presets.exportPresetById('youtube-1080') }).some((i) => i.code === 'texto-pequeno'))
    // Imagem parada até o fim do arquivo vira intervalo até a duração.
    const p = qc.parseQcLog('[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 4', '', 10)
    assert.deepEqual(p.freeze, [{ start: 4, end: 10 }])
  })
  await check('preset WhatsApp: bitrate calculado cabe no limite de tamanho', () => {
    const bps = presets.bitrateFor(15.5 * 1048576, 120)
    const bytes = ((bps + 128000) * 120) / 8
    assert.ok(bytes <= 15.5 * 1048576 && bytes > 13 * 1048576, `${(bytes / 1048576).toFixed(1)} MB`)
  })
  console.log(`\n${checks} verificações de render passaram.`)
} finally {
  if (!process.env.KEEP) rmSync(dir, { recursive: true, force: true }); else console.log(dir)
}
