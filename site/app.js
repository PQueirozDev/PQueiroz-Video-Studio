// Site do PQueiroz Video Studio: fluxo animado, galeria, cartão de uso e versão mais recente.
(() => {
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => [...el.querySelectorAll(s)]
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const REPO = 'PQueirozDev/PQueiroz-Video-Studio'

  // Versão mais recente publicada no GitHub Releases (mantém o texto padrão se falhar).
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      const v = rel?.tag_name?.replace(/^v/, '')
      if (v) $$('[data-version]').forEach((el) => (el.textContent = v))
    })
    .catch(() => {})

  // ---------------------------------------------------------------- fluxo
  const SCENES = {
    reel: {
      name: 'Reel de loja',
      req: 'Junte os clipes, tire as partes paradas e deixe pronto para Reels.',
      steps: [
        ['pedido', 'Claude está analisando os vídeos...', '▸ ffprobe nos 3 clipes · 1080×1920 · 30 fps'],
        ['claude', 'Preparando edição...', 'Leu CLAUDE.md e instrucao.txt'],
        ['fluxo', 'Aplicando cortes...', '▸ cortes nas batidas da trilha'],
        ['ffmpeg', 'Processando áudio...', '▸ loudnorm -14 LUFS · fade-out 2,5 s'],
        ['versao', 'Pronto: nova versão V1', 'Nova versão: V1 · 16,0 s']
      ]
    },
    audio: {
      name: 'Música alta',
      req: 'A música ficou muito alta.',
      steps: [
        ['pedido', 'Claude está analisando o áudio...', '▸ volumedetect na V1'],
        ['claude', 'Preparando edição...', 'Partindo da versão atual (V1)'],
        ['fluxo', 'Processando áudio...', '▸ trilha -6 dB sob a voz'],
        ['ffmpeg', 'Renderizando...', '▸ loudnorm em dois passos'],
        ['versao', 'Pronto: nova versão V2', 'Nova versão: V2 · trilha mais baixa']
      ]
    },
    story: {
      name: 'Versão Story',
      req: 'Agora faz uma versão de 15 s para Story, com a logo no final.',
      steps: [
        ['pedido', 'Planejando a edição...', 'Plano de edição: 5 passos'],
        ['claude', 'Aguardando aprovação...', '✓ Plano aprovado'],
        ['fluxo', 'Aplicando cortes...', '▸ encurta para 13,5 s + cartão final'],
        ['ffmpeg', 'Renderizando...', '▸ 1080×1920 · margens seguras do Story'],
        ['versao', 'Pronto: nova versão V3', 'Nova versão: V3 · 15,0 s']
      ]
    },
    voltar: {
      name: 'Voltar versão',
      req: 'Volte para a versão anterior.',
      steps: [
        ['pedido', 'Claude está lendo o histórico...', 'Versões: V1, V2, V3'],
        ['claude', 'Restaurando...', 'acao: restaurar V2'],
        ['versao', 'V2 é a versão atual', 'Versão V2 restaurada · nada foi apagado']
      ]
    }
  }

  const pipe = $('[data-pipe]')
  const log = $('[data-log]')
  const status = $('[data-status]')
  const statusBox = status?.parentElement
  const bar = $('[data-progress]')
  let timers = []
  let auto = null

  function play(id) {
    const sc = SCENES[id]
    if (!sc || !pipe) return
    timers.forEach(clearTimeout)
    timers = []
    $$('.chip').forEach((c) => {
      const on = c.dataset.scene === id
      c.classList.toggle('on', on)
      c.setAttribute('aria-pressed', String(on))
    })
    $('[data-scene-name]').textContent = sc.name
    $('[data-req]').textContent = sc.req
    log.innerHTML = ''
    bar.style.width = '0%'
    statusBox.classList.remove('done')
    $$('li', pipe).forEach((li) => li.classList.remove('on', 'done'))
    const gap = reduce ? 0 : 1100
    sc.steps.forEach(([step, text, line], i) => {
      timers.push(setTimeout(() => {
        $$('li', pipe).forEach((li) => {
          if (li.classList.contains('on')) li.classList.replace('on', 'done')
        })
        $(`[data-step="${step}"]`, pipe)?.classList.add('on')
        status.textContent = text
        bar.style.width = `${Math.round(((i + 1) / sc.steps.length) * 100)}%`
        const li = document.createElement('li')
        li.textContent = line
        if (/vers/i.test(line) && i === sc.steps.length - 1) li.className = 'ver'
        log.appendChild(li)
        if (i === sc.steps.length - 1) statusBox.classList.add('done')
      }, 350 + i * gap))
    })
  }

  const order = Object.keys(SCENES)
  function startAuto(from) {
    clearInterval(auto)
    let i = order.indexOf(from)
    if (reduce) return
    auto = setInterval(() => {
      i = (i + 1) % order.length
      play(order[i])
    }, 9000)
  }

  $$('.chip').forEach((c) => c.addEventListener('click', () => {
    play(c.dataset.scene)
    startAuto(c.dataset.scene)
  }))

  // Só começa quando a seção aparece.
  const flow = $('#fluxo')
  if (flow && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        play('reel')
        startAuto('reel')
        io.disconnect()
      }
    }, { threshold: 0.3 })
    io.observe(flow)
  } else {
    play('reel')
  }

  // ---------------------------------------------------------------- galeria
  const img = $('[data-shot-img]')
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => {
      x.classList.toggle('on', x === t)
      x.setAttribute('aria-selected', String(x === t))
    })
    img.style.opacity = '0'
    setTimeout(() => {
      img.src = `assets/${t.dataset.shot}.webp`
      img.alt = t.dataset.cap
      img.onload = () => (img.style.opacity = '1')
    }, 120)
    $('[data-shot-title]').textContent = t.textContent
    $('[data-shot-cap]').textContent = t.dataset.cap
  }))

  // ---------------------------------------------------------------- cartão de uso (demonstração)
  const big = $('[data-usage-big]')
  if (big && !reduce) {
    let a = 42
    let b = 31
    let mins = 192
    setInterval(() => {
      a = Math.min(96, a + Math.round(Math.random() * 3))
      if (a >= 96) a = 18
      b = Math.min(90, b + (Math.random() < 0.4 ? 1 : 0))
      mins = mins > 5 ? mins - 7 : 299
      big.textContent = a
      $('[data-usage-a]').textContent = `${a}%`
      $('[data-usage-b]').textContent = `${b}%`
      $('[data-usage-week]').textContent = b
      $('[data-usage-bar-a]').style.width = `${a}%`
      $('[data-usage-bar-b]').style.width = `${b}%`
      $('[data-usage-reset]').textContent = `◷ ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
    }, 2600)
  }

  // ---------------------------------------------------------------- copiar comandos
  const copy = $('[data-copy]')
  copy?.addEventListener('click', async () => {
    const text = $('[data-copy-src]').innerText.split('\n').filter((l) => !l.trim().startsWith('#')).map((l) => l.replace(/\s+#.*$/, '')).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      copy.textContent = 'copiado'
    } catch {
      copy.textContent = 'erro'
    }
    setTimeout(() => (copy.textContent = 'copiar'), 1600)
  })
})()
