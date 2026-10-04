import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Project } from '@shared/types'
import { projectPath } from '../projects/projects'
import { getSettings } from '../settings'
import { templateDir } from './aqc'

// Prepara <projeto>/edit a partir de E:\aqc\Modelo edicao (passo 4 do CLAUDE.md), aplicando na CÓPIA
// as correções necessárias neste computador. Os originais em E:\aqc nunca são alterados.

/** Distância da logo até as bordas superior e esquerda (pedido do Pedro). */
export const LOGO_MARGIN_PX = 16

export interface Patch { file: string; description: string; apply(src: string, aqc: string): string }

export const PATCHES: Patch[] = [
  {
    file: 'build.py',
    description: 'RES aponta para a pasta Recursos atual (o original cita C:\\aqc)',
    apply: (s, aqc) => s.replace(/^RES = Path\(r"[^"]*"\)/m, `RES = Path(r"${join(aqc, 'Recursos')}")`)
  },
  {
    file: 'montar.py',
    description: 'HISTORICO aponta para o historico_videos.json atual (o original cita C:\\aqc)',
    apply: (s, aqc) => s.replace(/^HISTORICO = Path\(r"[^"]*"\)/m, `HISTORICO = Path(r"${join(aqc, 'historico_videos.json')}")`)
  },
  {
    file: 'montar.py',
    description: 'FFmpeg 9: o ffprobe devolve "101," para trechos de foto; lê só o número',
    apply: (s) => s.replace('capture_output=True, text=True).stdout.strip())', 'capture_output=True, text=True).stdout.strip().split(",")[0])')
  },
  {
    file: 'montar.py',
    // logo_png() tem 20 px de margem transparente: em (-4, -4) a logo visível fica a 16 px das bordas.
    description: `Logo da Aquecedores Fortes mais no canto superior esquerdo (${LOGO_MARGIN_PX} px das bordas)`,
    apply: (s) => s.replace('(logo, 10, 40, 0.0, end, False)', '(logo, -4, -4, 0.0, end, False)')
  },
  {
    file: 'montar.py',
    // O logo (2).png tem ~17% de margem transparente à esquerda; sem recortar, a logo visível ficaria a ~130 px da borda.
    description: 'Recorta a margem transparente da logo (mesmo tamanho visível)',
    apply: (s) => s.replace('    logo = load_logo(600)\n    pad = 20',
      '    logo = load_logo(600)\n    logo = logo.crop(logo.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox())  # sem margem transparente\n    pad = 20')
  }
]

/**
 * Cria edit/ se ainda não existir e aplica as correções (também em edit/ antigas — cada correção
 * só troca o texto original, então rodar de novo não muda nada nem desfaz ajustes do Claude).
 */
export async function prepareEditFolder(project: Project): Promise<{ created: boolean; patches: string[] }> {
  const dest = projectPath(project, 'edit')
  const src = templateDir()
  const created = !existsSync(join(dest, 'montar.py'))
  if (created && !src) return { created: false, patches: [] }
  if (created) {
    await cp(src!, dest, {
      recursive: true,
      errorOnExist: false,
      force: false, // nunca sobrescreve nada que já esteja em edit/
      filter: (p) => basename(p) !== '__pycache__'
    })
  }
  const aqc = getSettings().aqcRoot
  const applied: string[] = []
  for (const patch of PATCHES) {
    const file = join(dest, patch.file)
    if (!existsSync(file)) continue
    const before = readFileSync(file, 'utf8')
    const after = patch.apply(before, aqc)
    if (after !== before) {
      writeFileSync(file, after, 'utf8')
      applied.push(`${patch.file}: ${patch.description}`)
    }
  }
  return { created, patches: applied }
}
