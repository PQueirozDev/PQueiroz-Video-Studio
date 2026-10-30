// Monta o pacote essencial do Asset Hub em resources/packs/pq-essentials (vem instalado com o app).
// Conteúdo:
//  - 15 famílias do Google Fonts (OFL, com a licença junto), baixadas antes para resources/fonts;
//  - SFX, overlays e LUTs ORIGINAIS dos packs HL/VEP do Pedro (criados para ele, redistribuíveis);
//  - SFX e overlays extras gerados aqui pelo FFmpeg (obra original, sem licença de terceiros);
//  - 20 templates de título e presets de movimento/cor (valores portados do HL_PACK/_tools/hl_presets.py).
// Uso: node scripts/build-essentials.mjs ["C:\\...\\Packs de Edicao"]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const packsSrc = process.argv[2] ?? 'C:\\Users\\Pedro\\Desktop\\Pedro\\Packs de Edicao'
const out = join('resources', 'packs', 'pq-essentials')
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a])
rmSync(out, { recursive: true, force: true })
for (const d of ['fonts', 'sfx', 'overlays', 'luts']) mkdirSync(join(out, d), { recursive: true })
const items = []

// ---------- fontes ----------
const FONTS = [
  ['anton', 'Anton', 'Anton-Regular.ttf'], ['archivo-black', 'Archivo Black', 'ArchivoBlack-Regular.ttf'], ['bangers', 'Bangers', 'Bangers-Regular.ttf'],
  ['bebas-neue', 'Bebas Neue', 'BebasNeue-Regular.ttf'], ['black-ops-one', 'Black Ops One', 'BlackOpsOne-Regular.ttf'], ['bungee', 'Bungee', 'Bungee-Regular.ttf'],
  ['kanit-bold', 'Kanit Bold', 'Kanit-Bold.ttf'], ['lobster', 'Lobster', 'Lobster-Regular.ttf'], ['monoton', 'Monoton', 'Monoton-Regular.ttf'],
  ['pacifico', 'Pacifico', 'Pacifico-Regular.ttf'], ['poppins-bold', 'Poppins Bold', 'Poppins-Bold.ttf'], ['poppins-regular', 'Poppins', 'Poppins-Regular.ttf'],
  ['press-start-2p', 'Press Start 2P', 'PressStart2P-Regular.ttf'], ['righteous', 'Righteous', 'Righteous-Regular.ttf'], ['russo-one', 'Russo One', 'RussoOne-Regular.ttf'],
  ['staatliches', 'Staatliches', 'Staatliches-Regular.ttf']
]
for (const [id, name, file] of FONTS) {
  copyFileSync(join('resources', 'fonts', file), join(out, 'fonts', file))
  items.push({ type: 'font', id, name, file: `fonts/${file}`, tags: ['google-fonts', 'ofl'] })
}
mkdirSync(join(out, 'fonts', 'licencas'), { recursive: true })
for (const f of readdirSync(join('resources', 'fonts')).filter((f) => f.startsWith('OFL-'))) copyFileSync(join('resources', 'fonts', f), join(out, 'fonts', 'licencas', f))

// ---------- SFX originais (HL) ----------
const hlSfx = join(packsSrc, 'HL_PACK', '08 - Sound Effects')
const SFX = [
  ['flash-pop', 'Flash pop', 'HL_Flash_Pop.wav', ['flash', 'pop']], ['glitch-burst', 'Glitch burst', 'HL_Glitch_Burst.wav', ['glitch']],
  ['glitch-stutter', 'Glitch stutter', 'HL_Glitch_Stutter.wav', ['glitch']], ['headshot-ding', 'Headshot ding', 'HL_Headshot_Ding.wav', ['valorant', 'kill', 'ding']],
  ['impact-boom', 'Impacto boom', 'HL_Impact_Boom.wav', ['impacto']], ['impact-punch', 'Impacto curto', 'HL_Impact_Punch_Short.wav', ['impacto']],
  ['reverse-swell', 'Reverse swell', 'HL_Reverse_Swell.wav', ['transicao', 'riser']], ['riser-2s', 'Riser 2 s', 'HL_Riser_2s.wav', ['riser', 'tensao']],
  ['sub-drop', 'Sub drop', 'HL_Sub_Drop.wav', ['grave', 'drop']], ['swoosh', 'Swoosh', 'HL_Swoosh_Transition.wav', ['transicao', 'whoosh']],
  ['whoosh', 'Whoosh', 'HL_Whoosh.wav', ['transicao', 'whoosh']], ['whoosh-fast', 'Whoosh rápido', 'HL_Whoosh_Fast.wav', ['transicao', 'whoosh']]
]
if (existsSync(hlSfx)) {
  for (const [id, name, file, tags] of SFX) {
    copyFileSync(join(hlSfx, file), join(out, 'sfx', `${id}.wav`))
    items.push({ type: 'sfx', id, name, file: `sfx/${id}.wav`, tags })
  }
} else console.warn('Pasta de packs não encontrada: SFX originais do HL ficaram de fora.')

// ---------- SFX gerados ----------
const GEN_SFX = [
  ['click', 'Clique', 'exp(-t*400)*sin(2*PI*2200*t)', 0.06, ['ui', 'clique']],
  ['pop', 'Pop', '0.9*exp(-t*30)*sin(2*PI*(700-600*t)*t)', 0.25, ['ui', 'pop']],
  ['typewriter', 'Máquina de escrever', '0.8*exp(-t*90)*(sin(2*PI*1800*t)+0.6*(random(0)*2-1))', 0.12, ['texto', 'digitar']],
  ['notify-ding', 'Notificação', '0.5*exp(-t*4)*(sin(2*PI*1318*t)+0.5*sin(2*PI*1976*t))', 1.2, ['ui', 'ding']],
  ['bass-hit', 'Grave de impacto', 'exp(-t*5)*sin(2*PI*(50*t+12*(1-exp(-t*25))))', 1.2, ['impacto', 'grave']],
  ['tape-stop', 'Tape stop', '0.5*sin(2*PI*(330*t-137.5*t*t))*(1-t/1.2)', 1.2, ['transicao', 'parada']],
  ['rise-short', 'Subida curta', '0.35*t*sin(2*PI*(200*t+450*t*t))+0.12*t*(random(0)*2-1)', 1.0, ['riser', 'transicao']],
  ['camera-shutter', 'Obturador', '0.9*(exp(-t*120)+exp(-(t-0.09)*120)*gte(t,0.09))*(random(0)*2-1)', 0.2, ['foto', 'clique']]
]
for (const [id, name, expr, d, tags] of GEN_SFX) {
  ff('-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${d}`, '-af', 'afade=t=out:st=' + (d * 0.85).toFixed(3) + ':d=' + (d * 0.15).toFixed(3) + ',alimiter=limit=0.9', '-ac', '2', '-c:a', 'pcm_s16le', join(out, 'sfx', `${id}.wav`))
  items.push({ type: 'sfx', id, name, file: `sfx/${id}.wav`, tags })
}

// ---------- overlays originais (HL/VEP) ----------
const OV = [
  ['flash-radial', 'Flash radial', 'HL_PACK/05 - Glow e Flash/Overlays/HL_Flash_Radial_Screen.mp4', ['flash']],
  ['flash-white', 'Flash branco', 'HL_PACK/05 - Glow e Flash/Overlays/HL_Flash_White_Screen.mp4', ['flash']],
  ['glitch-blocks', 'Blocos de glitch', 'HL_PACK/05 - Glow e Flash/Overlays/HL_Glitch_Blocks_Screen.mp4', ['glitch']],
  ['light-leak-warm', 'Light leak quente', 'HL_PACK/05 - Glow e Flash/Overlays/HL_Light_Leak_Warm_Screen.mp4', ['luz', 'cinema']],
  ['light-sweep', 'Varredura de luz', 'HL_PACK/05 - Glow e Flash/Overlays/HL_Light_Sweep_Screen.mp4', ['luz']],
  ['light-leak-cool', 'Light leak frio', 'VIDEO_EDITING_PACK/05 - Light Effects/Overlays/VEP_Light_Leak_Cool_Screen.mp4', ['luz', 'cinema']],
  ['film-burn', 'Queima de filme', 'VIDEO_EDITING_PACK/05 - Light Effects/Overlays/VEP_Film_Burn_Screen.mp4', ['filme', 'transicao']]
]
for (const [id, name, rel, tags] of OV) {
  const src = join(packsSrc, rel)
  if (!existsSync(src)) { console.warn(`Overlay ausente: ${rel}`); continue }
  copyFileSync(src, join(out, 'overlays', `${id}.mp4`))
  items.push({ type: 'overlay', id, name, file: `overlays/${id}.mp4`, blend: 'screen', tags })
}

// ---------- overlays gerados (fundo preto, para usar em "screen") ----------
const GEN_OV = [
  ['film-grain', 'Granulação de filme', 'color=c=black:s=960x540:r=30:d=2,noise=alls=45:allf=t+u,eq=brightness=-0.2:contrast=1.4', ['filme', 'textura']],
  ['dust', 'Poeira', "color=c=black:s=960x540:r=24:d=3,noise=alls=100:allf=t,lutyuv=y='if(gt(val,252),255,0)':u=128:v=128,gblur=sigma=0.7", ['filme', 'textura']],
  ['vhs-lines', 'Linhas de VHS', "color=c=black:s=960x540:r=30:d=3,format=gray,geq=lum='if(between(mod(Y+N*8,620),80,125),30,0)+if(eq(mod(Y,3),0),45,0)',noise=alls=8:allf=t,format=yuv420p", ['vhs', 'retro']]
]
for (const [id, name, src, tags] of GEN_OV) {
  ff('-f', 'lavfi', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(out, 'overlays', `${id}.mp4`))
  items.push({ type: 'overlay', id, name, file: `overlays/${id}.mp4`, blend: 'screen', tags })
}

// ---------- LUTs originais do VEP (as do HL já vêm em resources/luts) ----------
const vepLuts = join(packsSrc, 'VIDEO_EDITING_PACK', '07 - Color Grading', 'LUTs')
if (existsSync(vepLuts)) {
  for (const f of readdirSync(vepLuts).filter((f) => f.endsWith('.cube'))) {
    const id = 'vep-' + f.replace(/^VEP_/, '').replace(/\.cube$/, '').toLowerCase().replace(/_/g, '-')
    copyFileSync(join(vepLuts, f), join(out, 'luts', `${id}.cube`))
    items.push({ type: 'lut', id, name: 'VEP ' + f.replace(/^VEP_/, '').replace(/\.cube$/, '').replace(/_/g, ' '), file: `luts/${id}.cube`, tags: ['cor'] })
  }
}

// ---------- títulos ----------
const k = (t, v, ease = 'out') => ({ t, v, ease })
const ANIM = {
  pop: { zoom: [k(0, 1.35), k(0.22, 1)] },
  zoomOut: { zoom: [k(0, 1.6, 'inOut'), k(0.6, 1)] },
  slideUp: { y: [k(0, 0.08), k(0.35, 0)] },
  slideLeft: { x: [k(0, -0.45), k(0.4, 0)] },
  slideRight: { x: [k(0, 0.45), k(0.4, 0)] },
  drop: { y: [k(0, -0.25), k(0.3, 0.015), k(0.42, 0)] },
  wobble: { zoom: [k(0, 1.3), k(0.2, 1)], rotation: [k(0, -8), k(0.12, 5), k(0.24, -2), k(0.34, 0)] },
  shakeIn: { zoom: [k(0, 1.4), k(0.15, 1.05), k(0.4, 1)], x: [k(0, 0.015, 'linear'), k(0.05, -0.015, 'linear'), k(0.1, 0.01, 'linear'), k(0.15, -0.006, 'linear'), k(0.2, 0)] },
  slowZoom: { zoom: [k(0, 1, 'linear'), k(4, 1.08, 'linear')] }
}
const T = (id, name, style, duration, anim, fadeIn = 0.15, fadeOut = 0.25, tags = []) =>
  items.push({ type: 'title', id, name, tags, title: { style, duration, fadeIn, fadeOut, keyframes: anim ? ANIM[anim] : undefined } })
const thick = (c = '#000000') => ({ outline: 0.07, outlineColor: c })
T('impacto', 'Impacto central', { text: 'IMPACTO', font: 'anton', size: 0.17, ...thick(), shadow: 0.05 }, 2, 'pop', 0, 0.25, ['gaming'])
T('headshot', 'Headshot', { text: 'HEADSHOT', font: 'black-ops-one', size: 0.13, color: '#ff2d55', ...thick(), uppercase: true }, 1.8, 'shakeIn', 0, 0.3, ['gaming', 'valorant'])
T('clutch', 'Clutch', { text: 'CLUTCH!', font: 'bangers', size: 0.18, color: '#ffd60a', ...thick() }, 2, 'pop', 0, 0.3, ['gaming'])
T('ace', 'Ace', { text: 'ACE', font: 'russo-one', size: 0.22, color: '#00e5ff', ...thick('#001a33') }, 2.2, 'zoomOut', 0, 0.3, ['gaming', 'valorant'])
T('legenda-tiktok', 'Legenda TikTok', { text: 'legenda grande e legível', font: 'poppins-bold', size: 0.065, y: 0.72, outline: 0.12, shadow: 0, uppercase: true }, 2.5, null, 0.08, 0.08, ['legenda', 'shorts'])
T('legenda-caixa', 'Legenda com caixa', { text: 'Legenda com fundo', font: 'poppins-bold', size: 0.055, y: 0.84, box: 0.75, shadow: 0 }, 2.5, 'slideUp', 0.15, 0.15, ['legenda'])
T('lower-third', 'Lower third simples', { text: 'Seu nome\nfunção ou @perfil', font: 'poppins-bold', size: 0.05, x: 0.06, y: 0.84, align: 'left', box: 0.85, boxColor: '#111111', shadow: 0 }, 4, 'slideLeft', 0.15, 0.3, ['apresentacao'])
T('lower-third-destaque', 'Lower third destaque', { text: 'NOME EM DESTAQUE', font: 'bebas-neue', size: 0.075, x: 0.06, y: 0.82, align: 'left', box: 0.92, boxColor: '#7c3aed', shadow: 0 }, 4, 'slideLeft', 0.15, 0.3, ['apresentacao'])
T('cinema', 'Título de cinema', { text: 'O COMEÇO', font: 'bebas-neue', size: 0.12, color: '#f2f2f2', shadow: 0.02 }, 4, 'slowZoom', 0.8, 0.8, ['cinema'])
T('capitulo', 'Capítulo', { text: 'CAPÍTULO 1', font: 'archivo-black', size: 0.045, x: 0.06, y: 0.1, align: 'left', shadow: 0.03 }, 3, 'slideRight', 0.3, 0.4, ['cinema'])
T('neon', 'Neon', { text: 'NEON', font: 'monoton', size: 0.16, color: '#ff4fd8', shadow: 0 }, 3, null, 0.4, 0.4, ['retro'])
T('arcade', 'Arcade retrô', { text: 'LEVEL UP', font: 'press-start-2p', size: 0.06, color: '#39ff14', ...thick('#002200') }, 2.2, 'pop', 0, 0.2, ['gaming', 'retro'])
T('cartoon', 'Cartoon pop', { text: 'BOOM!', font: 'bangers', size: 0.2, color: '#ffffff', outline: 0.14, outlineColor: '#000000' }, 1.8, 'wobble', 0, 0.2, ['divertido'])
T('assinatura', 'Assinatura', { text: 'PQueiroz', font: 'pacifico', size: 0.07, x: 0.94, y: 0.88, align: 'right', shadow: 0.05 }, 4, null, 0.5, 0.5, ['marca'])
T('elegante', 'Elegante', { text: 'Uma história', font: 'lobster', size: 0.11, color: '#f5e6c8', shadow: 0.04 }, 3.5, null, 0.6, 0.6, ['cinema'])
T('placar', 'Placar', { text: '13 x 11', font: 'russo-one', size: 0.07, y: 0.1, box: 0.8, boxColor: '#0b0b10', shadow: 0 }, 3, 'drop', 0, 0.3, ['gaming'])
T('inscreva-se', 'Chamada: inscreva-se', { text: 'SE INSCREVA', font: 'kanit-bold', size: 0.07, y: 0.82, box: 0.95, boxColor: '#ff0033', shadow: 0 }, 3, 'slideUp', 0.1, 0.3, ['youtube', 'cta'])
T('citacao', 'Citação', { text: '"Uma frase marcante\nem duas linhas"', font: 'poppins-regular', size: 0.06, lineSpacing: 1.35, shadow: 0.03 }, 4, null, 0.5, 0.5, ['texto'])
T('titulo-subtitulo', 'Título + subtítulo', { text: 'TÍTULO PRINCIPAL\nsubtítulo aqui', font: 'staatliches', size: 0.1, lineSpacing: 1.1, shadow: 0.04 }, 3.5, 'slideUp', 0.3, 0.4, ['texto'])
T('alerta', 'Alerta', { text: 'ATENÇÃO', font: 'righteous', size: 0.08, color: '#111111', y: 0.15, box: 0.95, boxColor: '#ffd60a', shadow: 0 }, 2.5, 'pop', 0, 0.3, ['aviso'])

// ---------- presets (movimento: portados do HL_PACK; cor: LUT + efeitos) ----------
const F = 1 / 30
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
/** Tremor que decai até parar (mesma lógica do shake() do HL, em fração do quadro e graus). */
function shake(dur, amp, rot, seed, step = 2 * F) {
  const r = rng(seed)
  const x = [k(0, 0, 'linear')], y = [k(0, 0, 'linear')], rz = [k(0, 0, 'linear')]
  let t = step, sign = 1
  while (t < dur - step / 2) {
    const decay = 1 - t / dur
    x.push(k(+t.toFixed(3), +(sign * amp * decay * (0.6 + 0.4 * r())).toFixed(4), 'linear'))
    y.push(k(+t.toFixed(3), +(amp * 0.75 * decay * (r() * 2 - 1)).toFixed(4), 'linear'))
    rz.push(k(+t.toFixed(3), +(-sign * rot * decay * (0.5 + 0.5 * r())).toFixed(3), 'linear'))
    sign = -sign; t += step
  }
  x.push(k(dur, 0)); y.push(k(dur, 0)); rz.push(k(dur, 0))
  return { x, y, rotation: rz }
}
const P = (id, name, preset, tags = []) => items.push({ type: 'preset', id, name, tags, preset })
const pulse = (peak, tPeak, tEnd, base) => [k(0, base, 'linear'), k(+tPeak.toFixed(3), peak, 'linear'), k(+tEnd.toFixed(3), base)]
P('shake-impacto', 'Shake de impacto', { kind: 'motion', anchor: 'playhead', keyframes: { ...shake(0.25, 0.015, 1.5, 3), zoom: [k(0, 1.06, 'linear'), k(0.25, 1)] } }, ['shake', 'impacto'])
P('shake-pesado', 'Shake pesado', { kind: 'motion', anchor: 'playhead', keyframes: { ...shake(0.5, 0.03, 3.5, 7), zoom: [k(0, 1.12, 'linear'), k(0.5, 1)] } }, ['shake', 'impacto'])
P('recoil', 'Coice (recoil)', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1.04, 'linear'), k(0.3, 1)], y: [k(0, 0, 'linear'), k(F, 0.02, 'linear'), k(0.3, 0)], rotation: [k(0, 0, 'linear'), k(F, -1, 'linear'), k(0.3, 0)] } }, ['shake', 'arma'])
P('camera-na-mao', 'Câmera na mão', { kind: 'motion', anchor: 'start', keyframes: (() => { const r = rng(42); const x = [], y = [], rz = []; for (let t = 0; t <= 2 + 1e-9; t += 0.25) { x.push(k(+t.toFixed(2), +((r() * 2 - 1) * 0.004).toFixed(4), 'inOut')); y.push(k(+t.toFixed(2), +((r() * 2 - 1) * 0.004).toFixed(4), 'inOut')); rz.push(k(+t.toFixed(2), +((r() * 2 - 1) * 0.4).toFixed(3), 'inOut')) } return { x, y, rotation: rz, zoom: [k(0, 1.03, 'hold')] } })() }, ['camera', 'suave'])
P('zoom-in-suave', 'Zoom in suave', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'inOut'), k(1, 1.15)] } }, ['zoom'])
P('zoom-out-suave', 'Zoom out suave', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1.15, 'inOut'), k(1, 1)] } }, ['zoom'])
P('zoom-punch', 'Zoom punch', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'linear'), k(2 * F, 1.18), k(0.35, 1)] } }, ['zoom', 'impacto'])
P('zoom-punch-hold', 'Zoom punch e segura', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'linear'), k(2 * F, 1.18), k(0.25, 1.12)] } }, ['zoom', 'impacto'])
P('velocity-hit', 'Velocity hit', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'linear'), k(3 * F, 1.08), k(0.4, 1)], blur: pulse(10, 2 * F, 8 * F, 0) } }, ['velocity'])
P('velocity-push', 'Velocity push', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'in'), k(0.5, 1.2)], blur: [k(0, 0, 'linear'), k(0.3, 0, 'in'), k(0.5, 6)] } }, ['velocity', 'transicao'])
P('flash-branco', 'Flash branco', { kind: 'motion', anchor: 'playhead', keyframes: { brightness: pulse(0.6, F, 5 * F, 0), contrast: pulse(0.8, F, 5 * F, 1) } }, ['flash'])
P('flash-punch', 'Flash punch', { kind: 'motion', anchor: 'playhead', keyframes: { brightness: pulse(0.4, F, 6 * F, 0), contrast: pulse(1.45, F, 10 * F, 1), saturation: pulse(1.35, F, 0.5, 1) } }, ['flash', 'impacto'])
P('strobe', 'Strobe', { kind: 'motion', anchor: 'playhead', keyframes: { brightness: [k(0, 0, 'hold'), k(F, 0.55, 'hold'), k(2 * F, 0, 'hold'), k(3 * F, 0.55, 'hold'), k(4 * F, 0, 'hold'), k(5 * F, 0.35, 'hold'), k(7 * F, 0, 'hold')] } }, ['flash'])
P('glitch-cor', 'Glitch de cor', { kind: 'motion', anchor: 'playhead', effects: [{ type: 'rgb-split', params: { offset: 10 } }], keyframes: { saturation: pulse(1.6, F, 6 * F, 1), brightness: [k(0, 0, 'hold'), k(F, 0.15, 'hold'), k(3 * F, -0.1, 'hold'), k(5 * F, 0)] } }, ['glitch'])
P('headshot-impact', 'Headshot impact (combo)', { kind: 'motion', anchor: 'playhead', keyframes: { ...shake(0.3, 0.012, 1.5, 11), zoom: [k(0, 1, 'linear'), k(2 * F, 1.14), k(0.6, 1)], blur: pulse(4, F, 5 * F, 0), brightness: pulse(0.35, F, 4 * F, 0), saturation: pulse(1.3, F, 0.5, 1) } }, ['valorant', 'kill', 'combo'])
P('kill-suave', 'Kill suave (combo)', { kind: 'motion', anchor: 'playhead', keyframes: { zoom: [k(0, 1, 'inOut'), k(0.4, 1.1), k(1.2, 1)], saturation: pulse(1.25, 0.2, 1.0, 1) } }, ['valorant', 'kill', 'combo'])
P('look-cinema', 'Look cinema', { kind: 'look', effects: [{ type: 'lut', asset: 'teal-orange' }, { type: 'vignette', params: { strength: 0.45 } }, { type: 'film-grain', params: { amount: 10 } }] }, ['cor', 'cinema'])
P('look-valorant', 'Look Valorant', { kind: 'look', effects: [{ type: 'lut', asset: 'valorant-punch' }, { type: 'sharpen', params: { amount: 0.6 } }] }, ['cor', 'gaming'])
P('look-vintage', 'Look vintage', { kind: 'look', effects: [{ type: 'lut', asset: 'faded-film' }, { type: 'film-grain', params: { amount: 22 } }, { type: 'vignette', params: { strength: 0.6 } }] }, ['cor', 'retro'])
P('look-pb-drama', 'Look P&B dramático', { kind: 'look', effects: [{ type: 'lut', asset: 'bw-contrast' }, { type: 'vignette', params: { strength: 0.7 } }] }, ['cor', 'cinema'])
P('look-neon', 'Look neon noturno', { kind: 'look', effects: [{ type: 'lut', asset: 'night-neon' }, { type: 'color-grade', params: { saturation: 1.25, contrast: 1.1 } }] }, ['cor', 'gaming'])
P('look-quente', 'Look quente', { kind: 'look', effects: [{ type: 'lut', asset: 'warm-cinematic' }] }, ['cor'])
P('look-frio', 'Look frio', { kind: 'look', effects: [{ type: 'lut', asset: 'cold-blue' }] }, ['cor'])
P('look-vibrante', 'Look vibrante', { kind: 'look', effects: [{ type: 'lut', asset: 'vibrant-pop' }, { type: 'sharpen', params: { amount: 0.5 } }] }, ['cor'])
P('look-vhs', 'Look VHS', { kind: 'look', effects: [{ type: 'vhs', params: {} }] }, ['retro'])

const manifest = {
  format: 1, id: 'pq-essentials', name: 'Essenciais PQueiroz', version: '1.0.0', author: 'PQueiroz Studio',
  license: 'Fontes: SIL Open Font License 1.1 (licenças em fonts/licencas). SFX, overlays, LUTs, títulos e presets: obra original dos packs HL/VEP e do app, livres para uso no PQueiroz Studio.',
  description: '15 fontes do Google Fonts, efeitos sonoros, overlays de luz/filme, LUTs, 20 títulos e presets de movimento e cor.',
  items
}
writeFileSync(join(out, 'pack.json'), JSON.stringify(manifest, null, 1))
const count = (t) => items.filter((i) => i.type === t).length
console.log(`pq-essentials: ${items.length} itens — fontes ${count('font')}, sfx ${count('sfx')}, overlays ${count('overlay')}, luts ${count('lut')}, títulos ${count('title')}, presets ${count('preset')}`)
