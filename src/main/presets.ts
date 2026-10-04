import type { Preset, PresetInput } from '@shared/types'
import { all, run } from './db'
import { now, uid } from './util'

// Presets embutidos. O texto de `prompt` entra no contexto do Claude quando o projeto usa o preset.
export const PRESETS: Preset[] = [
  {
    id: 'nenhum', name: 'Nenhum', builtin: true, format: 'original',
    description: 'Sem preset — o Claude segue apenas o pedido e as regras do CLAUDE.md.',
    prompt: ''
  },
  {
    id: 'reel-rapido', name: 'Reel rápido', builtin: true, format: '9:16',
    description: '1080×1920, 15–30 s, cortes rápidos, música e textos curtos.',
    prompt: 'Preset "Reel rápido": 1080×1920, 30 fps, 15–30 s, cortes rápidos nas batidas, remova tudo que for parado, textos curtos na parte de baixo, loudnorm -14 LUFS.'
  },
  {
    id: 'reel-profissional', name: 'Reel profissional', builtin: true, format: '9:16',
    description: '1080×1920, 30–60 s, ritmo calmo, correção de cor e áudio caprichados.',
    prompt: 'Preset "Reel profissional": 1080×1920, 30 fps, 30–60 s, gancho forte nos primeiros 2 s, cortes naturais, zooms sutis, correção de cor leve, áudio limpo -14 LUFS / -1 dBTP.'
  },
  {
    id: 'story', name: 'Story', builtin: true, format: '9:16',
    description: '1080×1920, até 15 s por cartela, texto grande e legível.',
    prompt: 'Preset "Story": 1080×1920, 30 fps, até 15 s, texto grande dentro das margens seguras (topo 250 px e base 340 px livres).'
  },
  {
    id: 'youtube', name: 'YouTube', builtin: true, format: '16:9',
    description: '1920×1080, sem cortes agressivos, áudio -14 LUFS.',
    prompt: 'Preset "YouTube": 1920×1080 (16:9), ritmo natural, preserve as falas, música baixa sob a voz, loudnorm -14 LUFS.'
  },
  {
    id: 'antes-depois', name: 'Antes e Depois', builtin: true, format: '9:16',
    description: 'Estrutura ANTES → DEPOIS com rótulos e transição marcada.',
    prompt: 'Preset "Antes e Depois": estrutura ANTES (plano aberto + zoom na peça) → transição marcada → DEPOIS (um trecho por peça) → resultado, com os rótulos "ANTES"/"DEPOIS" na parte de baixo da tela.'
  },
  {
    id: 'aquecedores-fortes', name: 'Aquecedores Fortes', builtin: true, format: '9:16',
    description: 'O vídeo padrão aprovado: Modelo edicao/montar.py, 1080×1920, ~45–55 s.',
    prompt: 'Preset "Aquecedores Fortes": siga exatamente a seção "Vídeo padrão (aprovado pelo Pedro)" e "Como fazer um vídeo novo" do CLAUDE.md, usando uma cópia de "Modelo edicao" (montar.py). Pergunte endereço, bairro e nome exato do serviço se não estiverem no pedido.'
  }
]

interface PresetRow { id: string; name: string; format: string; description: string; prompt: string }

/** Embutidos + personalizados (guardados no SQLite). */
export function listPresets(): Preset[] {
  const custom = all<PresetRow>('SELECT * FROM presets ORDER BY created_at').map((r) => ({
    id: r.id, name: r.name, builtin: false, format: r.format as Preset['format'], description: r.description, prompt: r.prompt
  }))
  return [...PRESETS, ...custom]
}

export function presetById(id: string): Preset {
  return listPresets().find((p) => p.id === id) ?? PRESETS[0]
}

function clean(input: PresetInput): PresetInput {
  const name = input.name.trim()
  if (!name) throw new Error('Dê um nome ao preset.')
  return { name: name.slice(0, 60), format: input.format, description: input.description.trim().slice(0, 200), prompt: input.prompt.trim().slice(0, 4000) }
}

export function savePreset(id: string | null, input: PresetInput): Preset {
  const c = clean(input)
  if (id && PRESETS.some((p) => p.id === id)) throw new Error('Presets embutidos não podem ser alterados — duplique-o.')
  if (id) {
    run('UPDATE presets SET name = ?, format = ?, description = ?, prompt = ? WHERE id = ?', c.name, c.format, c.description, c.prompt, id)
  } else {
    id = `custom-${uid()}`
    run('INSERT INTO presets(id, name, format, description, prompt, created_at) VALUES(?, ?, ?, ?, ?, ?)', id, c.name, c.format, c.description, c.prompt, now())
  }
  return presetById(id)
}

export function deletePreset(id: string): void {
  run('DELETE FROM presets WHERE id = ?', id)
  // Projetos que usavam o preset voltam para "Nenhum".
  run("UPDATE projects SET preset = 'nenhum' WHERE preset = ?", id)
}
