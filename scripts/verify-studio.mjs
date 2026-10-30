import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readFileSync as readText, existsSync as existsSyncFs, mkdirSync } from 'node:fs'
const mkdirIfNeededSync = (d) => mkdirSync(d, { recursive: true })
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { build } from 'esbuild'

// Exercita o SQLite real em uma pasta temporária. Só Electron e FFmpeg são substituídos.
const root = mkdtempSync(join(tmpdir(), 'pqueiroz-verification-'))
globalThis.__studioTest = { root, jobs: [], encoders: false, gate: null }
const bundle = await build({
  stdin: { contents: `export * as db from './src/main/db'; export * as settings from './src/main/settings'; export * as projects from './src/main/projects/projects'; export * as media from './src/main/media/media'; export * as timeline from './src/main/media/timeline'; export * as history from './src/main/media/history'; export * as compStore from './src/main/composition/store'; export * as analyze from './src/main/analysis/analyze'; export * as highlights from './src/shared/highlights'; export * as music from './src/shared/music'; export * as whisper from './src/main/analysis/whisper'; export * as filterArg from './src/main/media/filterArg'; export * as beats from './src/main/analysis/beats'; export * as beatsWorker from './src/main/analysis/beatsWorker'; export * as subtitles from './src/main/media/subtitles'; export * as formats from './src/shared/subtitles'; export * as versions from './src/main/versions/versions'; export * as render from './src/main/render/queue'; export * as png from './src/main/image/png'; export * as pdf from './src/main/image/pdf'; export * as doc from './src/shared/imageDoc'; export * as image from './src/shared/image'; export * as brands from './src/main/image/brands'; export * as imageProjects from './src/main/image/imageProjects'; export * as providers from './src/main/image/providers'; export * as secrets from './src/main/image/secrets'; export * as packs from './src/main/packs/packs'; export * as zip from './src/main/packs/zip'; export * as packFmt from './src/shared/packs'; export * as luts from './src/main/assets/luts'; export * as fx from './src/shared/fx'; export * as comp from './src/shared/composition'; export * as agent from './src/main/agent/tools'; export * as bridge from './src/main/agent/bridge'; export * as captions from './src/shared/captions'; export * as styles from './src/main/styles/styles'; export * as style from './src/shared/style';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24',
  plugins: [{ name: 'test-boundaries', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
    b.onResolve({ filter: /(?:^|\/)ffmpeg$/ }, () => ({ path: 'ffmpeg', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'electron'
      ? `export const app = { getPath: () => globalThis.__studioTest.root, getAppPath: () => process.cwd(), isPackaged: false };
         export const safeStorage = { isEncryptionAvailable: () => true,
           encryptString: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
           decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString() };`
      : `import { writeFileSync } from 'node:fs';
         export const probe = async () => ({ duration: 10, width: 1920, height: 1080, hasAudio: true, fps: 30 });
         export const thumbnail = async () => false;
         export const hasEncoder = async () => { if (globalThis.__studioTest.gate) await globalThis.__studioTest.gate; return globalThis.__studioTest.encoders; };
         export const runFfmpeg = async (args, duration, progress, cwd) => {
           let finish; const done = new Promise(r => finish = r);
           writeFileSync(args.at(-1), 'fake video');
           globalThis.__studioTest.jobs.push({ args, cwd, finish, progress });
           return { child: { pid: undefined }, done };
         };` }))
  } }]
})
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const mkdirIfNeeded = async (d) => (await import('node:fs')).mkdirSync(d, { recursive: true })
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 10)) }
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log(`OK ${name}`) }
try {
  m.settings.updateSettings({ projectsRoot: join(root, 'projects'), exportRoot: join(root, 'exports'), hwAccel: false, maxConcurrentRenders: 1, useProxies: false })
  const p = m.projects.createProject({ name: 'Teste', format: '16:9', resolution: '1080p', fps: '30', preset: 'nenhum' })
  const addMedia = (id, sort) => {
    const path = join(p.path, 'input', `${id}.mp4`)
    writeFileSync(path, 'video')
    m.db.run(`INSERT INTO media(id,project_id,kind,name,path,size,duration,has_audio,sort,added_at) VALUES(?,?,'video',?,?,5,10,1,?,1)`, id, p.id, id, path, sort)
    return path
  }
  const input = addMedia('a', 0); addMedia('b', 1)
  m.history.editWithHistory(p.id, () => m.timeline.setTrim(p.id, 'a', 1, 5))
  m.history.editWithHistory(p.id, () => m.media.reorderMedia(p.id, ['b', 'a']))
  m.history.editWithHistory(p.id, () => m.timeline.setInTimeline(p.id, 'a', false))
  m.history.travelHistory(p.id, 'undo')
  check('desfazer retirada de clipe', () => assert.equal(m.media.listMedia(p.id).find(x => x.id === 'a').inTimeline, true))
  m.history.travelHistory(p.id, 'undo')
  check('desfazer ordem preserva corte', () => { assert.equal(m.media.listMedia(p.id)[0].id, 'a'); assert.equal(m.media.listMedia(p.id)[0].trimIn, 1) })
  m.history.travelHistory(p.id, 'undo')
  check('desfazer corte', () => assert.equal(m.media.listMedia(p.id)[0].trimIn, null))
  m.history.travelHistory(p.id, 'redo')
  check('refazer corte', () => assert.equal(m.media.listMedia(p.id)[0].trimOut, 5))
  m.history.editWithHistory(p.id, () => m.timeline.setTrim(p.id, 'a', 2, 6))
  check('nova edição elimina ramo futuro', () => assert.equal(m.history.historyState(p.id).redo, false))
  check('cortes vazios e NaN não alteram histórico', () => {
    const before = m.db.one('SELECT past FROM timeline_history WHERE project_id=?', p.id).past
    assert.throws(() => m.history.editWithHistory(p.id, () => m.timeline.setTrim(p.id, 'a', 10, null)))
    assert.throws(() => m.timeline.setTrim(p.id, 'a', NaN, null))
    assert.equal(m.db.one('SELECT past FROM timeline_history WHERE project_id=?', p.id).past, before)
  })
  // Composição: projetos antigos viram composição "legacy" idêntica à timeline simples.
  const cs = m.compStore
  check('timeline simples vira composição com os mesmos cortes', () => {
    const { doc: c } = cs.getComposition(p.id)
    assert.equal(c.origin, 'legacy')
    const v = c.clips.filter((x) => x.trackId === 'V1')
    assert.deepEqual(v.map((x) => [x.mediaId, x.start, x.in, x.out]), [['a', 0, 2, 6], ['b', 4, 0, 10]])
  })
  check('edição por comando vira manual, grava backup e desfaz para a simples', () => {
    const r = cs.editComposition(p.id, [{ type: 'addTrack', kind: 'video' }, { type: 'addMarker', time: 1, label: 'gancho' }])
    assert.equal(r.doc.origin, 'manual'); assert.equal(r.createdIds[0], 'V2')
    const file = JSON.parse(readText(join(p.path, 'composition.json'), 'utf8'))
    assert.equal(file.markers[0].label, 'gancho')
    const u = cs.travelComposition(p.id, 'undo')
    assert.equal(u.doc.origin, 'legacy'); assert.equal(u.redo, true)
    assert.equal(cs.travelComposition(p.id, 'redo').doc.tracks.length, 3)
  })
  check('lote com um comando inválido não aplica nenhum', () => {
    const before = JSON.stringify(cs.getComposition(p.id).doc)
    assert.throws(() => cs.editComposition(p.id, [{ type: 'addMarker', time: 2 }, { type: 'moveClip', clipId: 'nao-existe', start: 0 }]), /Edição 2/)
    assert.equal(JSON.stringify(cs.getComposition(p.id).doc), before)
  })
  check('banco corrompido recupera a composição pelo arquivo do projeto', () => {
    m.db.run("UPDATE compositions SET doc = '{quebrado' WHERE project_id = ?", p.id)
    assert.equal(cs.getComposition(p.id).doc.markers[0].label, 'gancho')
    m.db.run('DELETE FROM compositions WHERE project_id = ?', p.id)
    assert.equal(cs.getComposition(p.id).doc.origin, 'manual')
  })
  check('pilha de desfazer corrompida não trava o projeto', () => {
    m.db.run("UPDATE compositions SET past = 'lixo', future = '{}' WHERE project_id = ?", p.id)
    const st = cs.getComposition(p.id)
    assert.equal(st.undo, false); assert.equal(st.redo, false)
    cs.editComposition(p.id, [{ type: 'addMarker', time: 3 }])
    assert.equal(cs.getComposition(p.id).undo, true)
  })
  check('composição de versão mais nova é recusada e não é sobrescrita', () => {
    const future = JSON.stringify({ version: 99, origin: 'manual', tracks: [], clips: [], markers: [] })
    m.db.run('UPDATE compositions SET doc = ? WHERE project_id = ?', future, p.id)
    assert.throws(() => cs.getComposition(p.id), /mais nova/)
    assert.throws(() => cs.editComposition(p.id, [{ type: 'addMarker', time: 1 }]), /mais nova/)
    assert.equal(m.db.one('SELECT doc FROM compositions WHERE project_id = ?', p.id).doc, future)
    m.db.run('DELETE FROM compositions WHERE project_id = ?', p.id)
  })
  check('voltar para a timeline simples deixa um passo de desfazer', () => {
    const r = cs.resetComposition(p.id)
    assert.equal(r.doc.origin, 'legacy'); assert.equal(r.undo, true)
  })
  const doc = { ...m.formats.emptySubtitles(), cues: [{ id: 'one', start: 1.125, end: 2.5, text: 'Olá, mundo!\nSegunda linha' }] }
  check('SRT preserva texto e milissegundos', () => { const parsed = m.formats.parseSrt(m.formats.toSrt(doc)); assert.equal(parsed[0].start, 1.125); assert.equal(parsed[0].text, doc.cues[0].text) })
  check('legendas rejeitam sobreposição e tempos inválidos', () => {
    assert.throws(() => m.formats.validateSubtitles({ ...doc, cues: [...doc.cues, { id: 'two', start: 2, end: 3, text: 'sobreposição' }] }))
    assert.throws(() => m.formats.parseSrt('1\n00:00:02,000 --> 00:00:01,000\nerrado'))
  })
  check('ASS sanitiza marcações e conserva quebra de linha', () => {
    const ass = m.formats.toAss({ ...doc, cues: [{ ...doc.cues[0], text: '{\\pos(1,2)}Olá\nMundo' }] }, 1920, 1080)
    assert.ok(!ass.includes('{')); assert.ok(ass.includes('\\N')); assert.ok(ass.includes('0:00:01.12') || ass.includes('00:00:01.12'))
  })
  m.subtitles.saveSubtitles(p.id, input, doc)
  check('legendas persistem e pertencem à origem', () => { assert.deepEqual(m.subtitles.loadSubtitles(p.id, input), doc); assert.throws(() => m.subtitles.loadSubtitles(p.id, join(root, 'outside.mp4'))) })
  writeFileSync(m.subtitles.subtitleFile(p.id, input), m.formats.toSrt({ ...doc, cues: [{ ...doc.cues[0], text: 'Gerada' }] }))
  check('SRT gerado atualiza documento salvo', () => assert.equal(m.subtitles.reloadGeneratedSubtitles(p.id, input).cues[0].text, 'Gerada'))
  m.db.run(`INSERT INTO versions(id,project_id,number,label,path,created_at) VALUES('v1',?,1,'V1',?,1)`, p.id, input)
  m.versions.favoriteVersion(p.id, 'v1', true)
  check('favoritas persistem e validam projeto', () => { assert.equal(m.versions.listVersions(p.id)[0].favorite, true); assert.throws(() => m.versions.favoriteVersion('outro', 'v1', false)) })
  const options = { container: 'mp4', resolution: '1080p', fps: '30', quality: 'alta', subtitles: doc }
  const j1 = m.render.enqueueRender(p.id, { path: input, label: 'V1' }, options)
  const j2 = m.render.enqueueRender(p.id, { path: input, label: 'V1' }, options)
  await flush()
  check('fila reserva nomes e limita concorrência', () => { assert.notEqual(j1.output, j2.output); assert.equal(globalThis.__studioTest.jobs.length, 1); assert.equal(m.render.getJob(j2.id).status, 'aguardando') })
  check('render recebe ASS no diretório correto', () => { const job = globalThis.__studioTest.jobs[0]; assert.ok(job.args.includes(`scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,ass=${j1.id}.ass`) || job.args.some(x => x.includes(`ass=${j1.id}.ass`))); assert.ok(job.cwd.endsWith(join('temp','render'))) })
  globalThis.__studioTest.jobs[0].finish({ code: 0, stderr: '' }); await flush()
  check('conclusão inicia próximo render', () => { assert.equal(m.render.getJob(j1.id).status, 'concluido'); assert.equal(globalThis.__studioTest.jobs.length, 2) })
  globalThis.__studioTest.jobs[1].finish({ code: 0, stderr: '' }); await flush()
  m.render.cancelRender(j1.id)
  check('cancelamento não altera render concluído', () => assert.equal(m.render.getJob(j1.id).status, 'concluido'))
  globalThis.__studioTest.encoders = true
  m.settings.updateSettings({ hwAccel: true })
  const gpu = m.render.enqueueRender(p.id, { path: input, label: 'GPU' }, options); await flush()
  globalThis.__studioTest.jobs.at(-1).finish({ code: 1, stderr: 'GPU unavailable' }); await flush()
  check('falha de GPU inicia CPU e informa usuário', () => { assert.equal(m.render.getJob(gpu.id).encoder, 'libx264'); assert.match(m.render.getJob(gpu.id).notice, /GPU falhou/); assert.equal(m.render.getJob(gpu.id).progress, 0) })
  globalThis.__studioTest.jobs.at(-1).finish({ code: 0, stderr: '' }); await flush()
  let release
  globalThis.__studioTest.gate = new Promise(r => release = r)
  const count = globalThis.__studioTest.jobs.length
  const cancelled = m.render.enqueueRender(p.id, { path: input, label: 'Cancelar' }, options)
  m.render.cancelRender(cancelled.id)
  release(); globalThis.__studioTest.gate = null; await flush()
  check('cancelar durante preparação impede processo', () => { assert.equal(m.render.getJob(cancelled.id).status, 'cancelado'); assert.equal(globalThis.__studioTest.jobs.length, count) })
  // ————— Image Studio —————
  const { deflateSync } = await import('node:zlib')
  const { readFileSync, existsSync, readdirSync } = await import('node:fs')
  const assetsRoot = join(root, 'biblioteca')
  m.settings.updateSettings({ assetsRoot })
  {
    // PDF mínimo com uma imagem RGB 4x2 e máscara alfa (1ª coluna transparente).
    const rgb = Buffer.alloc(4 * 2 * 3, 200); const alpha = Buffer.from([0, 255, 255, 255, 0, 255, 255, 255])
    const a = deflateSync(rgb), b = deflateSync(alpha)
    const pdfBuf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 2 0 R /Filter /FlateDecode /Length ${a.length} >>\nstream\n`, 'latin1'), a,
      Buffer.from(`\nendstream\nendobj\n2 0 obj\n<< /Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${b.length} >>\nstream\n`, 'latin1'), b,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')])
    const imgs = m.pdf.extractPdfImages(pdfBuf)
    check('PDF: extrai imagem com alfa e ignora a máscara', () => { assert.equal(imgs.length, 1); assert.equal(imgs[0].width, 3); assert.equal(imgs[0].height, 2); assert.equal(imgs[0].data[3], 255) })
    check('PNG: codifica e decodifica sem perda', () => { const back = m.png.decodePng(m.png.encodePng(imgs[0])); assert.equal(Buffer.compare(back.data, imgs[0].data), 0) })
    const pdfPath = join(root, 'Logo teste.pdf'); writeFileSync(pdfPath, pdfBuf)
    const brand = m.brands.createBrand({ name: 'Marca Teste', colors: [{ name: 'X', hex: 'red;}' }] })
    const logos = m.brands.importLogo(brand.id, pdfPath)
    check('marca: importa logo do PDF como PNG na pasta da marca', () => { assert.equal(logos.length, 1); assert.ok(existsSync(logos[0].path)); assert.ok(logos[0].path.startsWith(assetsRoot)); assert.equal(m.brands.getBrand(brand.id).defaultLogoId, logos[0].id) })
    check('marca: cores inválidas viram cor segura', () => assert.equal(brand.colors[0].hex, '#000000'))
    check('marca padrão Aquecedores Fortes existe e não pode ser excluída', () => { assert.ok(m.brands.getBrand('aquecedores-fortes')); assert.throws(() => m.brands.deleteBrand('aquecedores-fortes')) })
    const af = m.brands.getBrand('aquecedores-fortes')
    if (af.logos.length) check('logo AF do PDF real: versões colorida e branca', () => { assert.deepEqual(af.logos.map(l => l.variant).sort(), ['branca', 'colorida']) })

    // Projeto de imagem
    const created = m.imageProjects.createImageProject({ name: 'Arte Teste', brandId: brand.id, formatId: 'ig-feed', prompt: 'Arte de teste', style: 'premium-3d' })
    const ip = created.project
    check('projeto de imagem: kind, formato e logo inicial', () => {
      assert.equal(ip.kind, 'image'); assert.equal(created.doc.width, 1080); assert.equal(created.doc.height, 1350)
      const logo = created.doc.layers.find(l => l.role === 'logo'); assert.ok(logo); assert.ok(Math.abs(logo.w / logo.h - 1.5) < 0.02)
    })
    check('projeto de vídeo continua sendo vídeo', () => assert.equal(m.projects.getProject(p.id).kind, 'video'))
    const outside = join(root, 'fora.png'); writeFileSync(outside, m.png.encodePng(imgs[0]))
    const d1 = m.doc.sanitizeDoc({ ...created.doc, layers: [...created.doc.layers,
      { type: 'image', role: 'subject', src: outside, x: 0, y: 0, w: 10, h: 10 },
      { type: 'image', role: 'logo', src: logos[0].path, fit: 'cover', flipX: true, saturation: 2, rotation: 25, x: 0, y: 0, w: 30, h: 20 },
      { type: 'text', text: 'Olá', size: 'abc', fill: { type: 'linear', stops: [{ color: 'url(x)' }, { color: '#fff' }] } },
      { type: 'script', evil: true }] }, { checkPath: m.imageProjects.pathChecker(ip) })
    check('sanitização: bloqueia imagem fora das pastas e camadas desconhecidas', () => { assert.ok(!d1.layers.some(l => l.src === outside)); assert.ok(!d1.layers.some(l => l.type === 'script')) })
    check('sanitização: logo nunca é distorcida nem recolorida', () => { const l = d1.layers.filter(l => l.role === 'logo').at(-1); assert.equal(l.fit, 'contain'); assert.equal(l.flipX, false); assert.equal(l.saturation, 1); assert.equal(l.rotation, 0) })
    check('sanitização: valores inválidos viram padrões seguros', () => { const t = d1.layers.find(l => l.type === 'text'); assert.equal(t.size, 64); assert.equal(t.fill.stops[0].color, '#ffffff') })
    const story = m.doc.adaptDoc(created.doc, 'ig-story')
    check('adaptar formato: Stories 1080x1920 com logo na área segura e proporção mantida', () => {
      assert.equal(story.width, 1080); assert.equal(story.height, 1920)
      const logo = story.layers.find(l => l.role === 'logo'); assert.ok(logo.y >= 250); assert.ok(Math.abs(logo.w / logo.h - 1.5) < 0.03)
    })
    check('análise: aponta texto fora da área segura', () => {
      const bad = { ...created.doc, layers: [m.doc.textLayer('Promoção', -20, 5, 400, 100, { size: 80 })] }
      assert.ok(m.doc.analyzeDoc(bad).some(i => /área segura/.test(i.text)))
    })

    // Versões e edições do Claude
    const r1 = m.imageProjects.saveDesign(ip.id, { ...created.doc, layers: [...created.doc.layers, m.doc.textLayer('Título', 100, 300, 880, 200)] })
    check('design salvo incrementa revisão', () => assert.ok(r1.revision >= 2))
    m.imageProjects.lockDesign(ip.id, true)
    check('design travado enquanto o Claude trabalha', () => assert.throws(() => m.imageProjects.saveDesign(ip.id, created.doc), /Claude/))
    const before = m.imageProjects.captureDesignState(ip.id)
    const designPath = join(ip.path, 'design.json')
    const edited = JSON.parse(readFileSync(designPath, 'utf8')); edited.layers.find(l => l.type === 'text').text = 'Feliz Dia dos Professores'
    writeFileSync(designPath, JSON.stringify(edited))
    const snap = m.imageProjects.snapshotDesign(ip.id, before, 'troca o título', 'ok')
    m.imageProjects.lockDesign(ip.id, false)
    check('Claude edita design.json → nova versão com JSON e PNG pendente', () => {
      assert.equal(snap.designChanged, true); assert.equal(snap.versions.length, 1)
      assert.equal(m.imageProjects.pendingRenders(ip.id).length, 1)
      assert.equal(m.imageProjects.versionDoc(ip.id, snap.versions[0].id).layers.find(l => l.type === 'text').text, 'Feliz Dia dos Professores')
    })
    const before2 = m.imageProjects.captureDesignState(ip.id)
    writeFileSync(designPath, '{ quebrado')
    await mkdirIfNeeded(join(ip.path, 'variacoes'))
    writeFileSync(join(ip.path, 'variacoes', 'variacao-1.json'), JSON.stringify({ ...edited, background: { type: 'solid', color: '#102344' } }))
    const snap2 = m.imageProjects.snapshotDesign(ip.id, before2, 'variações', 'ok')
    check('JSON inválido do Claude é descartado e o anterior volta', () => { assert.equal(snap2.designChanged, false); assert.equal(m.imageProjects.readDesign(ip.id).layers.find(l => l.type === 'text').text, 'Feliz Dia dos Professores') })
    check('variações viram versões sem trocar o design', () => { assert.equal(snap2.versions.length, 1); assert.equal(m.imageProjects.versionDoc(ip.id, snap2.versions[0].id).background.color, '#102344') })
    const png = m.png.encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 255) })
    await m.imageProjects.attachRender(ip.id, snap.versions[0].id, png)
    check('PNG anexado à versão e fora da lista de pendentes', () => { assert.ok(existsSync(m.versions.getVersion(snap.versions[0].id).path)); assert.equal(m.imageProjects.pendingRenders(ip.id).length, 1) })
    await assert.rejects(() => m.imageProjects.attachRender(ip.id, snap.versions[0].id, Buffer.from('not a png')))
    const restored = m.imageProjects.restoreImageVersion(ip.id, snap2.versions[0].id)
    check('restaurar versão reescreve o design e preserva as versões', () => { assert.equal(restored.doc.background.color, '#102344'); assert.equal(m.versions.listVersions(ip.id).length, 2) })
    const e1 = m.imageProjects.exportImage(ip.id, png, 'png'), e2 = m.imageProjects.exportImage(ip.id, png, 'png')
    check('exportação nunca sobrescreve', () => { assert.notEqual(e1, e2); assert.ok(existsSync(e1) && existsSync(e2)) })
    assert.throws(() => m.imageProjects.exportImage(ip.id, png, 'jpg'))

    // Provedores e chaves
    check('composição local está sempre pronta e é gratuita', () => { const c = m.providers.listProviders().find(x => x.id === 'composition'); assert.ok(c.ready); assert.equal(c.paid, false) })
    check('provedor pago sem chave não fica pronto', () => assert.equal(m.providers.listProviders().find(x => x.id === 'openai').ready, false))
    m.providers.setProviderKey('openai', 'sk-test-1234567890abcd')
    check('chave criptografada e só a dica volta', () => {
      const info = m.providers.listProviders().find(x => x.id === 'openai'); assert.equal(info.keyHint, '…abcd'); assert.ok(!JSON.stringify(info).includes('sk-test'))
      assert.ok(!m.db.one("SELECT value FROM secrets").value.includes('sk-test'))
    })
    assert.throws(() => m.providers.configureProvider('openai', { endpoint: 'http://evil.example' }))
    await assert.rejects(() => m.providers.generateImage({ projectId: ip.id, provider: 'pollinations', prompt: 'sol', role: 'background', width: 1080, height: 1350 }), /desativado/)
    m.providers.configureProvider('pollinations', { enabled: true })
    let calls = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url) => { calls++; assert.ok(String(url).includes('width=')); return new Response(png, { status: 200 }) }
    try {
      const g1 = await m.providers.generateImage({ projectId: ip.id, provider: 'pollinations', prompt: 'warm sunny room', role: 'background', width: 1080, height: 1350, requestKey: 'msg1:0' })
      const g2 = await m.providers.generateImage({ projectId: ip.id, provider: 'pollinations', prompt: 'warm sunny room', role: 'background', width: 1080, height: 1350, requestKey: 'msg1:0' })
      check('geração salva no projeto e não repete o mesmo pedido', () => { assert.ok(g1.path.startsWith(join(ip.path, 'assets', 'gerado'))); assert.equal(g1.path, g2.path); assert.equal(calls, 1) })
      await assert.rejects(() => m.providers.generateImage({ projectId: p.id, provider: 'pollinations', prompt: 'x y z', role: 'background', width: 100, height: 100 }), /Image Studio/)
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'insufficient credits' } }), { status: 402 })
      await assert.rejects(() => m.providers.generateImage({ projectId: ip.id, provider: 'openai', prompt: 'sun', role: 'background', width: 1080, height: 1080 }), /créditos/)
      check('erro de créditos do provedor é explicado', () => true)
      const other = m.imageProjects.createImageProject({ name: 'Outra', brandId: null, formatId: 'ig-square', prompt: '', style: 'premium-3d' }).project
      check('geração em cache não vaza para outro projeto', () => assert.equal(m.providers.generationFor(other.id, 'msg1:0'), null))
      check('SD local só aceita endereço local', () => { assert.throws(() => m.providers.configureProvider('sd-local', { endpoint: 'http://example.com:7860' })); assert.ok(m.providers.configureProvider('sd-local', { endpoint: 'http://127.0.0.1:7861' })) })
      check('projeto novo já escolhe o gerador pronto', () => assert.notEqual(m.imageProjects.imageInfo(other.id).provider, 'composition'))
    } finally { globalThis.fetch = realFetch }
  }
  check('saída do whisper vira legendas sem lixo de silêncio', () => {
    const cues = m.whisper.parseWhisperJson('{"start":0,"end":2000,"text":" Olá,  pessoal!"}\n{"start":2000,"end":2500,"text":" ..."}\n{"start":2500,"end":3000,"text":"[Música]"}\nlinha quebrada\n{"start":3000,"end":5000,"text":"Tudo certo?"}', 10)
    assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[10, 12, 'Olá, pessoal!'], [13, 15, 'Tudo certo?']])
  })
  check('tempos da legenda encostam na fala medida', () => {
    const [c] = m.whisper.alignToSpeech([{ id: 'a', start: 0, end: 4, text: 'oi' }], [{ start: 0, end: 2.1 }, { start: 3.5, end: 4.4 }])
    assert.deepEqual([c.start, c.end], [2.05, 3.65])
  })
  check('caminho em filtro do FFmpeg escapa as duas camadas', () => {
    assert.equal(m.filterArg.filterPath("C:\\a b\\it's, [x]; y.bin"), "C\\\\:/a b/it\\\\\\'s\\, \\[x\\]\\; y.bin")
  })
  // Regressões da revisão do Codex (Fase 2).
  check('blocos de energia não derivam em arquivos longos e o último bloco não se perde', () => {
    const meter = m.analyze.blockMeter(11025)
    const total = 11025 * 3600 + 500 // 1 h + meio bloco
    for (let i = 0; i < total; i++) meter.push(0.5)
    meter.flush()
    assert.equal(meter.blocks.length, 36001)
  })
  check('log de análise lido linha a linha dá o mesmo resultado', () => {
    const p = m.analyze.audioLogParser(10)
    for (const l of ['[x] silence_start: 1.5', '[x] silence_end: 2.5 | silence_duration: 1', 'Summary:', '    I:         -18.2 LUFS', '    Peak:      -0.5 dBFS', '[x] silence_start: 9']) p.push(l)
    const r = p.result()
    assert.deepEqual(r.silences, [{ start: 1.5, end: 2.5 }, { start: 9, end: 10 }])
    assert.equal(r.loudness.integrated, -18.2); assert.equal(r.loudness.truePeak, -0.5)
  })
  check('silêncio não gera grade de batidas inventada', () => {
    const r = m.beats.analyzeBeats(new Float32Array(11025 * 10), 11025)
    assert.equal(r.bpm, 0); assert.equal(r.beats.length, 0)
  })
  check('highlight nunca é menor que o pedido nem passa do fim do arquivo', () => {
    const a = { mediaId: 'x', duration: 3.2, scenes: [], motion: [0, 0, 0, 0, 0, 0, 0], black: [], silences: [], energy: [-20, -20, -20, -20, -20, -5, -5], transients: [2.6], loudness: {}, clippingRisk: false, music: null }
    for (const h of m.highlights.findHighlights([a], { length: 2, count: 3, mode: 'gameplay' })) {
      assert.ok(Math.abs(h.end - h.start - 2) < 1e-9 && h.end <= 3.2 + 1e-9, `${h.start}–${h.end}`)
    }
  })
  check('montagem recusa padrão de batidas inválido', () => {
    const hl = [{ mediaId: 'g', start: 0, end: 4, score: 1, reasons: [] }]
    for (const pattern of [[0], [1.5], [-2]]) assert.throws(() => m.music.beatMontage(hl, [0, 0.5, 1, 1.5, 2], 's', 10, { beatsPerClip: 2, pattern }), /inteiros/)
    assert.throws(() => m.music.beatMontage(hl, [0, 0.5, 1], 's', 10, { beatsPerClip: 2, firstBeat: 0.5 }), /inicial/)
  })
  await (async () => {
    const pcm = new Float32Array(11025 * 8)
    for (let i = 0; i < pcm.length; i++) { const ph = (i / 11025) % 0.5; pcm[i] = ph < 0.05 ? Math.sin(2 * Math.PI * 80 * ph) * Math.exp(-40 * ph) : 0 }
    const r = await m.beatsWorker.analyzeBeatsInWorker(pcm, 11025)
    assert.ok(Math.abs(r.bpm - 120) < 2, `BPM na worker ${r.bpm}`)
    const ctrl = new AbortController(); ctrl.abort()
    await assert.rejects(() => m.beatsWorker.analyzeBeatsInWorker(pcm, 11025, ctrl.signal), /cancelada/)
    checks++; console.log('OK batidas rodam numa worker thread e respeitam cancelamento')
  })()
  // Análise com o FFmpeg real (cenas, pretos, silêncio, transientes, BPM). Ignorada sem FFmpeg.
  const { spawnSync: sp } = await import('node:child_process')
  if (sp('ffmpeg', ['-version']).status === 0) {
    const checkAsync = async (name, fn) => { await fn(); checks++; console.log(`OK ${name}`) }
    const ap = m.projects.createProject({ name: 'Análise', format: '16:9', resolution: '1080p', fps: '30', preset: 'nenhum' })
    const vid = join(ap.path, 'input', 'gameplay.mp4')
    // 0–3 s vermelho em silêncio | 3–3,6 s preto | 3,6–7,6 s imagem agitada com estouros de som a cada 0,5 s.
    sp('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=320x240:r=30:d=3', '-f', 'lavfi', '-i', 'color=black:s=320x240:r=30:d=0.6', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=4',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=3.6', '-f', 'lavfi', '-i', 'sine=f=300:d=4',
      '-filter_complex', "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[4:a]volume='if(lt(mod(t,0.5),0.08),1,0.02)':eval=frame[b];[3:a][b]concat=n=2:v=0:a=1[a]",
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid])
    // Música sintética a 120 BPM (bumbo + chimbal no contratempo), gravada como WAV.
    const sr = 22050, dur = 16, pcm = new Int16Array(sr * dur)
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr, p = 0.5, ph = (t - 0.25) % p, ph2 = (t - 0.25 + p / 2) % p
      const kick = t >= 0.25 && ph < 0.12 ? Math.sin(2 * Math.PI * (60 + 100 * Math.exp(-30 * ph)) * ph) * Math.exp(-25 * ph) : 0
      const hat = t > 0.25 && ph2 < 0.02 ? Math.sin(i * 12.9898) * 0.4 * Math.exp(-200 * ph2) : 0
      pcm[i] = Math.round((0.7 * kick + hat + 0.04 * Math.sin(2 * Math.PI * 220 * t)) * 30000)
    }
    const wav = Buffer.alloc(44 + pcm.byteLength)
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.byteLength, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.byteLength, 40)
    Buffer.from(pcm.buffer).copy(wav, 44)
    const song = join(ap.path, 'assets', 'musica.wav')
    await mkdirIfNeeded(join(ap.path, 'assets')); writeFileSync(song, wav)
    m.db.run(`INSERT INTO media(id,project_id,kind,name,path,size,duration,has_audio,sort,added_at) VALUES('g',?,'video','gameplay.mp4',?,1,7.6,1,0,1)`, ap.id, vid)
    m.db.run(`INSERT INTO media(id,project_id,kind,name,path,size,duration,has_audio,sort,added_at) VALUES('s',?,'audio','musica.wav',?,1,16,1,1,1)`, ap.id, song)
    const gm = m.media.listMedia(ap.id).find((x) => x.id === 'g')
    const sm = m.media.listMedia(ap.id).find((x) => x.id === 's')
    let ga
    await checkAsync('análise acha cortes de cena, trecho preto, silêncio e transientes', async () => {
      ga = await m.analyze.analyzeMedia(ap.id, gm)
      assert.ok(ga.scenes.some((t) => Math.abs(t - 3) < 0.25), `corte em 3 s: ${ga.scenes}`)
      assert.ok(ga.black.some((b) => b.start < 3.2 && b.end > 3.4), `preto em 3–3,6 s: ${JSON.stringify(ga.black)}`)
      assert.ok(ga.silences.some((s) => s.start < 0.3 && s.end > 3.2), `silêncio no começo: ${JSON.stringify(ga.silences)}`)
      assert.ok(ga.transients.filter((t) => t > 3.5).length >= 4, `estouros detectados: ${ga.transients}`)
      assert.ok(ga.loudness.integrated !== null && ga.motion.length >= 14)
    })
    await checkAsync('segunda análise vem do cache', async () => {
      const again = await m.analyze.analyzeMedia(ap.id, gm)
      assert.equal(again.analyzedAt, ga.analyzedAt)
    })
    check('highlight de gameplay escolhe a parte agitada e explica o motivo', () => {
      const [h] = m.highlights.findHighlights([ga], { length: 2, count: 1, mode: 'gameplay' })
      assert.ok(h.start >= 3.4, `trecho escolhido ${h.start}–${h.end}`)
      assert.ok(h.reasons.length > 0)
    })
    check('corte de silêncio mantém só o trecho com som', () => {
      const keep = m.highlights.keepRanges(ga, 0.7, 0.1)
      assert.equal(keep.length, 1); assert.ok(keep[0].start > 3 && keep[0].end > 7.4)
      const cmds = m.highlights.rangesToCommands('g', keep)
      assert.equal(cmds[0].type, 'addClip'); assert.equal(cmds[0].start, 0)
    })
    let music
    await checkAsync('música: BPM e batidas detectados no arquivo real', async () => {
      const sa = await m.analyze.analyzeMedia(ap.id, sm)
      music = sa.music
      assert.ok(music && Math.abs(music.bpm - 120) < 1.5, `BPM ${music?.bpm}`)
      const off = music.beats.slice(2, -2).map((b) => Math.abs(((b - 0.25) % 0.5 + 0.5) % 0.5 > 0.25 ? 0.5 - (((b - 0.25) % 0.5 + 0.5) % 0.5) : ((b - 0.25) % 0.5 + 0.5) % 0.5))
      assert.ok(Math.max(...off) < 0.05, `batidas fora do bumbo: ${Math.max(...off)}`)
    })
    check('montagem musical corta exatamente nas batidas e valida na composição', () => {
      const hl = [{ mediaId: 'g', start: 3.6, end: 7.6, score: 1, reasons: [] }, { mediaId: 'g', start: 0, end: 3, score: 0.5, reasons: [] }]
      const mt = m.music.beatMontage(hl, music.beats, 's', 16, { beatsPerClip: 4 })
      const beatsRel = music.beats.map((b) => b - music.beats[0])
      for (const c of mt.cuts) assert.ok(beatsRel.some((b) => Math.abs(b - c) < 0.002), `corte fora da batida: ${c}`)
      const r = m.compStore.editComposition(ap.id, [{ type: 'clearTimeline' }, ...mt.commands])
      assert.equal(r.doc.clips.length, 3)
    })
  }
  // ---------- Asset Hub ----------
  check('pacote essencial: manifesto válido, arquivos presentes e quantidades prometidas', () => {
    const info = m.packs.packInfos().find((x) => x.id === 'pq-essentials')
    assert.ok(info && info.builtIn, 'pacote essencial instalado')
    const items = m.packs.hubItems().filter((i) => i.packId === 'pq-essentials')
    const raw = JSON.parse(readText(join('resources', 'packs', 'pq-essentials', 'pack.json'), 'utf8'))
    assert.equal(items.length, raw.items.length, 'todo item do manifesto tem arquivo existente')
    const families = new Set(items.filter((i) => i.type === 'font').map((i) => i.name.replace(/ (Bold|Regular)$/, '')))
    assert.ok(families.size >= 15, `15 famílias de fonte, veio ${families.size}`)
    assert.ok(items.filter((i) => i.type === 'title').length >= 20, '20 títulos')
    assert.ok(m.fx.TRANSITIONS.length >= 30, `30 transições, veio ${m.fx.TRANSITIONS.length}`)
    assert.ok(m.fx.EFFECTS.filter((e) => e.kind !== 'audio').length >= 25, '25 efeitos de imagem')
  })
  check('títulos e presets do pacote só usam fontes, efeitos e LUTs que existem', () => {
    const fonts = m.packs.fontMap()
    const luts = m.luts.lutMap()
    for (const it of m.packs.hubItems()) {
      if (it.type === 'title') assert.ok(fonts.has(m.comp.readTitle(it.title.style).font), `fonte do título ${it.key}`)
      if (it.type === 'preset') for (const e of it.preset.effects ?? []) {
        const def = m.fx.effectById(e.type)
        assert.ok(def, `efeito ${e.type} do preset ${it.key}`)
        m.fx.normalizeParams(def, e.params ?? {})
        if (def.asset === 'lut') assert.ok(luts.has(e.asset), `LUT ${e.asset} do preset ${it.key}`)
      }
    }
    assert.ok(luts.has('vep-teal-orange') && luts.has('teal-orange'), 'LUTs do app e do pacote juntas')
  })
  check('manifesto: recusa caminho para fora, extensão proibida e id repetido', () => {
    const base = { format: 1, id: 'teste', name: 'T', version: '1', author: 'a', license: 'CC0' }
    assert.throws(() => m.packFmt.validateManifest({ ...base, items: [{ type: 'sfx', id: 'a', name: 'A', file: '../a.wav' }] }), /arquivo/)
    assert.throws(() => m.packFmt.validateManifest({ ...base, items: [{ type: 'sfx', id: 'a', name: 'A', file: 'a.exe' }] }), /arquivo/)
    assert.throws(() => m.packFmt.validateManifest({ ...base, items: [{ type: 'font', id: 'a', name: 'A', file: 'C:/a.ttf' }] }), /arquivo/)
    assert.throws(() => m.packFmt.validateManifest({ ...base, items: [{ type: 'lut', id: 'a', name: 'A', file: 'a.cube' }, { type: 'lut', id: 'a', name: 'B', file: 'b.cube' }] }), /repetido/)
    assert.throws(() => m.packFmt.validateManifest({ ...base, id: 'Com Espaço', items: [] }), /id/)
  })
  check('zip: ida e volta com CRC e recusa nome com ".."', () => {
    const z = join(root, 'teste.zip')
    const big = Buffer.alloc(200000, 7)
    m.zip.writeZip(z, [{ name: 'pack.json', data: Buffer.from('{"a":1}') }, { name: 'aa/evil.txt', data: Buffer.from('oi') }, { name: 'dados/grande.bin', data: big }])
    const r = new m.zip.ZipReader(z)
    assert.deepEqual(r.entries.map((e) => e.name), ['pack.json', 'aa/evil.txt', 'dados/grande.bin'])
    assert.ok(r.read(r.entries[2]).equals(big))
    r.close()
    const bytes = readText(z)
    let i = -1
    while ((i = bytes.indexOf('aa/evil.txt', i + 1)) >= 0) bytes.write('../evil.txt', i)
    writeFileSync(z, bytes)
    assert.throws(() => new m.zip.ZipReader(z), /inseguro/)
  })
  check('zip: tamanhos mentirosos no cabeçalho são recusados antes de ler; silêncio grande reinstala', () => {
    const z = join(root, 'mentira.zip')
    m.zip.writeZip(z, [{ name: 'a.txt', data: Buffer.from('abc') }])
    const bytes = readText(z)
    const cd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    bytes.writeUInt32LE(0xfffffff0, cd + 20)
    writeFileSync(z, bytes)
    assert.throws(() => new m.zip.ZipReader(z), /corrompido|grande demais/)
    const quiet = join(root, 'quiet.zip')
    const silence = Buffer.alloc(12 * 1024 * 1024)
    m.zip.writeZip(quiet, [{ name: 'sfx/silencio.wav', data: silence }])
    const r = new m.zip.ZipReader(quiet)
    assert.ok(r.read(r.entries[0]).equals(silence)); r.close()
  })
  check('instalar .pqs-pack: só extrai o que o manifesto cita, aparece no hub e pode ser removido', () => {
    const src = join(root, 'meu-pack')
    mkdirIfNeededSync(join(src, 'sfx'))
    writeFileSync(join(src, 'sfx', 'bip.wav'), 'RIFF....WAVE')
    writeFileSync(join(src, 'virus.exe'), 'MZ')
    writeFileSync(join(src, 'LICENSE.txt'), 'CC0')
    writeFileSync(join(src, 'pack.json'), JSON.stringify({ format: 1, id: 'meu-pack', name: 'Meu pack', version: '1.0.0', author: 'eu', license: 'CC0', items: [{ type: 'sfx', id: 'bip', name: 'Bip', file: 'sfx/bip.wav' }] }))
    const out = join(root, 'meu-pack.pqs-pack')
    const ex = m.packs.exportPackFolder(src, out)
    assert.equal(ex.items, 1)
    const info = m.packs.installPack(out)
    assert.equal(info.id, 'meu-pack'); assert.equal(info.builtIn, false)
    const dir = join(root, 'packs', 'meu-pack')
    assert.ok(existsSyncFs(join(dir, 'sfx', 'bip.wav')) && existsSyncFs(join(dir, 'LICENSE.txt')))
    assert.ok(!existsSyncFs(join(dir, 'virus.exe')), 'arquivo fora do manifesto não é extraído')
    assert.ok(m.packs.hubItems().some((i) => i.key === 'meu-pack/bip'))
    m.packs.removePack('meu-pack')
    assert.ok(!m.packs.hubItems().some((i) => i.packId === 'meu-pack') && !existsSyncFs(dir))
    assert.throws(() => m.packs.removePack('pq-essentials'), /vem com o app/)
    writeFileSync(join(src, 'pack.json'), JSON.stringify({ format: 1, id: 'pq-essentials', name: 'Falso', version: '9', author: 'x', license: 'x', items: [] }))
    m.packs.exportPackFolder(src, out)
    assert.throws(() => m.packs.installPack(out), /vem com o app/)
  })
  // ---------- agente (ferramentas estruturadas + MCP) ----------
  const checkAsync = async (name, fn) => { await fn(); checks++; console.log(`OK ${name}`) }
  await checkAsync('ferramentas do agente: estado, catálogo, edição em lote com "$N", desfazer e erros legíveis', async () => {
    const pa = m.projects.createProject({ name: 'Agente', format: '16:9', resolution: '1080p', fps: '30', preset: 'nenhum' })
    const path = join(pa.path, 'input', 'v.mp4'); writeFileSync(path, 'video')
    m.db.run(`INSERT INTO media(id,project_id,kind,name,path,size,duration,has_audio,sort,added_at) VALUES('vv',?,'video','v.mp4',?,5,10,1,0,1)`, pa.id, path)
    const st = await m.agent.callTool(pa.id, 'estado_projeto', {})
    assert.equal(st.midias[0].id, 'vv')
    const cat = await m.agent.callTool(pa.id, 'catalogo', { tipo: 'hub' })
    assert.ok(cat.assets.some((a) => a.chave === 'pq-essentials/headshot'))
    const r = await m.agent.callTool(pa.id, 'editar_timeline', { commands: [{ type: 'clearTimeline' }, { type: 'addClip', mediaId: 'vv', start: 0, in: 0, out: 4 }, { type: 'addEffect', clipId: '$1', effect: 'vignette' }, { type: 'addTitle', start: 1, duration: 2, title: { text: 'Oi' } }] })
    assert.equal(r.criados.length, 3)
    assert.ok(r.projeto.clipes.some((c) => c.efeitos?.[0]?.tipo === 'vignette') && r.projeto.clipes.some((c) => c.titulo === 'Oi'))
    const preset = await m.agent.callTool(pa.id, 'usar_asset', { chave: 'pq-essentials/zoom-punch', clipId: r.criados[0], inicio: 1 })
    assert.ok(preset.projeto.clipes.find((c) => c.id === r.criados[0]).animado.includes('zoom'))
    const titulo = await m.agent.callTool(pa.id, 'usar_asset', { chave: 'pq-essentials/clutch', inicio: 3, texto: 'CLUTCH 1v3' })
    assert.ok(titulo.projeto.clipes.some((c) => c.titulo === 'CLUTCH 1v3'))
    await assert.rejects(m.agent.callTool(pa.id, 'editar_timeline', { commands: [{ type: 'addEffect', clipId: 'nao-existe', effect: 'vignette' }] }), /Clipe não encontrado/)
    const und = await m.agent.callTool(pa.id, 'desfazer', {})
    assert.ok(!und.projeto.clipes.some((c) => c.titulo === 'CLUTCH 1v3'))
    await assert.rejects(m.agent.callTool(pa.id, 'apagar_tudo', {}), /desconhecida/)
    const ctrl = new AbortController(); ctrl.abort()
    await assert.rejects(m.agent.callTool(pa.id, 'editar_timeline', { commands: [{ type: 'clearTimeline' }] }, ctrl.signal), /cancelado/)
  })
  check('legendas na timeline seguem cortes e velocidade do vídeo', () => {
    let d = m.comp.emptyComposition()
    const ctx = { media: new Map([['vv', { id: 'vv', kind: 'video', duration: 20, hasAudio: true }]]), newId: (p) => p + Math.random().toString(36).slice(2, 7) }
    d = m.comp.applyCommand(d, { type: 'addClip', mediaId: 'vv', start: 0, in: 10, out: 14 }, ctx).doc
    const c2 = m.comp.applyCommand(d, { type: 'addClip', mediaId: 'vv', start: 4, in: 0, out: 2 }, ctx); d = c2.doc
    d = m.comp.applyCommand(d, { type: 'setSpeed', clipId: c2.createdId, speed: 2 }, ctx).doc
    const cmds = m.captions.captionCommands(d, 'vv', [{ start: 0.5, end: 1.5, text: 'começo' }, { start: 6, end: 7, text: 'cortado' }, { start: 11, end: 12, text: 'meio' }])
    const titles = cmds.filter((c) => c.type === 'addTitle').map((c) => [c.title.text, c.start, c.duration])
    assert.deepEqual(titles, [['meio', 1, 1], ['começo', 4.25, 0.5]])
  })
  await checkAsync('servidor MCP: initialize, tools/list e tools/call pela ponte com token', async () => {
    const out = join(root, 'mcp.mjs')
    await build({ entryPoints: ['src/main/agent/mcp.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: out, alias: { '@shared': './src/shared' } })
    const http = await import('node:http')
    const calls = []
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
        calls.push({ auth: req.headers.authorization, body: JSON.parse(body) })
        res.end(JSON.stringify(req.headers.authorization === 'Bearer t0k' ? { ok: true, result: { eco: JSON.parse(body).name } } : { ok: false, error: 'token' }))
      })
    })
    await new Promise((r) => srv.listen(0, '127.0.0.1', r))
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, [out], { env: { ...process.env, PQ_BRIDGE_URL: `http://127.0.0.1:${srv.address().port}/tool`, PQ_BRIDGE_TOKEN: 't0k' } })
    const replies = []
    let buf = ''
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1) } })
    const ask = (msg) => child.stdin.write(JSON.stringify(msg) + '\n')
    ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    ask({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'estado_projeto', arguments: {} } })
    ask({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'inexistente', arguments: {} } })
    for (let i = 0; i < 100 && replies.length < 4; i++) await new Promise((r) => setTimeout(r, 50))
    child.kill(); srv.close()
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]))
    assert.equal(byId[1].result.serverInfo.name, 'pqstudio')
    assert.ok(byId[2].result.tools.length >= 10 && byId[2].result.tools.every((t) => t.inputSchema?.type === 'object'))
    assert.equal(JSON.parse(byId[3].result.content[0].text).eco, 'estado_projeto')
    assert.equal(byId[4].error.code, -32602)
    assert.equal(calls.length, 1, 'ferramenta desconhecida nem chega na ponte')
  })
  await checkAsync('ponte do agente: só aceita o token do turno e só em 127.0.0.1', async () => {
    const s = await m.bridge.openAgentSession(p.id)
    const post = (headers, body = '{"name":"estado_projeto","args":{}}') => fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }).then((r) => r.json().then((j) => ({ status: r.status, j })))
    assert.equal((await post({ Authorization: 'Bearer errado' })).status, 401)
    const ok = await post({ Authorization: `Bearer ${s.token}` })
    assert.ok(ok.j.ok && Array.isArray(ok.j.result.midias))
    assert.equal((await post({ Authorization: `Bearer ${s.token}`, Origin: 'http://evil.example' })).status, 404)
    assert.equal((await post({ Authorization: 'Bearer ' + s.token }, 'null')).status, 400, 'corpo nulo não derruba o processo')
    s.close()
    assert.equal((await post({ Authorization: `Bearer ${s.token}` })).status, 401, 'token revogado no fim do turno')
  })
  // ---------- Style Memory ----------
  await checkAsync('Style Memory: aprende de uma edição, segue o cliente e veste outro projeto', async () => {
    const mk = (name) => {
      const pr = m.projects.createProject({ name, format: '16:9', resolution: '1080p', fps: '30', preset: 'nenhum' })
      for (const [id, kind, dur] of [['v' + name, 'video', 30], ['a' + name, 'audio', 60]]) {
        const fp = join(pr.path, 'input', id + (kind === 'video' ? '.mp4' : '.mp3')); writeFileSync(fp, 'x')
        m.db.run(`INSERT INTO media(id,project_id,kind,name,path,size,duration,has_audio,sort,added_at) VALUES(?,?,?,?,?,5,?,1,0,1)`, id, pr.id, kind, id, fp, dur)
      }
      return pr
    }
    const a = mk('A'), b = mk('B')
    const cmds = [{ type: 'clearTimeline' }]
    for (let i = 0; i < 6; i++) cmds.push({ type: 'addClip', mediaId: 'vA', trackId: 'V1', start: i * 2, in: i * 2, out: i * 2 + 2 })
    for (let i = 1; i <= 6; i++) cmds.push({ type: 'addEffect', clipId: '$' + i, effect: 'lut', asset: 'teal-orange' }, { type: 'addEffect', clipId: '$' + i, effect: 'vignette', params: { strength: 0.3 } })
    cmds.push({ type: 'addTitle', start: 0, duration: 2, title: { text: 'Abertura', font: 'anton', color: '#ffd60a', size: 0.14, uppercase: true } })
    cmds.push({ type: 'addClip', mediaId: 'aA', start: 0, in: 0, out: 12 }, { type: 'setClipProps', clipId: '$' + (cmds.length), volume: 0.25 })
    cmds.push({ type: 'setMix', mix: { normalize: true, targetLufs: -16 } })
    await m.agent.callTool(a.id, 'editar_timeline', { commands: cmds })
    const brand = m.brands.createBrand({ name: 'Cliente Teste' })
    m.styles.setProjectStyle(a.id, { brandId: brand.id })
    const st = await m.agent.callTool(a.id, 'aprender_estilo', { nome: 'Gaming do cliente', observacoes: 'legenda sempre amarela' })
    const prof = m.styles.getStyle(st.id)
    assert.equal(prof.brandId, brand.id, 'estilo fica com o cliente do projeto')
    assert.deepEqual(prof.look.map((e) => e.type + (e.asset ?? '')), ['lutteal-orange', 'vignette'])
    assert.equal(prof.title.font, 'anton'); assert.equal(prof.title.color, '#ffd60a')
    assert.equal(prof.pacing.medianClip, 2); assert.equal(prof.audio.musicVolume, 0.25); assert.equal(prof.audio.targetLufs, -16)
    // Projeto B do mesmo cliente herda o estilo; aplicar veste a timeline dele.
    m.styles.setProjectStyle(b.id, { brandId: brand.id })
    assert.equal(m.styles.projectStyle(b.id).styleId, st.id)
    await m.agent.callTool(b.id, 'editar_timeline', { commands: [{ type: 'clearTimeline' }, { type: 'addClip', mediaId: 'vB', trackId: 'V1', start: 0, in: 0, out: 5 }, { type: 'addEffect', clipId: '$1', effect: 'vignette', params: { strength: 0.9 } }, { type: 'addTitle', start: 0, duration: 2, title: { text: 'Outro', x: 0.2 } }, { type: 'addClip', mediaId: 'aB', start: 0, in: 0, out: 20 }] })
    const ap = await m.agent.callTool(b.id, 'aplicar_estilo', { estiloId: st.id })
    const docB = m.compStore.getComposition(b.id).doc
    const clipB = docB.clips.find((c) => c.mediaId === 'vB')
    assert.deepEqual(clipB.effects.map((e) => e.type), ['lut', 'vignette'], 'look trocado sem duplicar a vinheta')
    assert.equal(clipB.effects[1].params.strength, 0.3)
    const tB = docB.clips.find((c) => c.title)
    assert.ok(tB.title.font === 'anton' && tB.title.text === 'Outro' && tB.title.x === 0.2, 'título ganha a cara do estilo, mantém texto e posição')
    assert.equal(docB.clips.find((c) => c.mediaId === 'aB').volume, 0.25)
    assert.equal(docB.mix.targetLufs, -16)
    assert.ok(ap.mudancas > 3)
    const list = await m.agent.callTool(b.id, 'estilos', {})
    assert.ok(list.projeto.cliente === 'Cliente Teste' && list.estilos[0].instrucoes === 'legenda sempre amarela' && /cortes a cada ~2s/.test(list.estilos[0].resumo))
    // "Nenhum" vence o padrão do cliente; trocar de cliente solta o estilo escolhido do cliente antigo.
    m.styles.setProjectStyle(b.id, { styleId: 'none' })
    assert.equal(m.styles.projectStyle(b.id).style, null)
    m.styles.setProjectStyle(b.id, { styleId: st.id })
    const other = m.brands.createBrand({ name: 'Outro Cliente' })
    m.styles.setProjectStyle(b.id, { brandId: other.id })
    assert.equal(m.styles.projectStyle(b.id).style, null, 'estilo do cliente anterior não acompanha')
    m.styles.setProjectStyle(b.id, { brandId: brand.id, styleId: null })
    assert.equal(m.styles.projectStyle(b.id).choice, '')
    assert.equal(m.styles.projectStyle(b.id).styleId, st.id, 'volta a herdar o padrão do cliente')
    m.styles.deleteStyle(st.id)
    assert.equal(m.styles.projectStyle(b.id).style, null)
  })
  console.log(`${checks} verificações passaram.`)
} finally {
  m.db.getDb().close()
  const rel = relative(tmpdir(), root)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('pqueiroz-verification-')) rmSync(root, { recursive: true, force: true })
}
