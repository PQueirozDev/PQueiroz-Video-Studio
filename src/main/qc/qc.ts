import { existsSync, statSync } from 'node:fs'
import { checkComposition, checkRender, parseQcLog, qcAnalysisArgs, QC_LOG_LINE, type QcItem, type RenderMeasures } from '@shared/qc'
import { exportPresetById } from '@shared/exportPresets'
import { listLuts } from '../assets/luts'
import { getComposition, mediaRefs } from '../composition/store'
import { spawn } from 'node:child_process'
import { probe } from '../media/ffmpeg'
import { ffmpegPath } from '../tools'
import { listMedia } from '../media/media'
import { fontMap } from '../packs/packs'
import { requireProject } from '../projects/projects'
import { listVersions } from '../versions/versions'
import { outputFormat } from '../media/timeline'

// Quality Check: verificação da timeline (instantânea) e do arquivo renderizado (uma passada do FFmpeg
// com ebur128 + blackdetect + silencedetect + freezedetect).

export function checkProject(projectId: string, presetId?: string): QcItem[] {
  const project = requireProject(projectId)
  const doc = getComposition(projectId).doc
  const items = listMedia(projectId)
  const out = outputFormat(project, items, doc)
  return checkComposition(doc, {
    aspect: out.w / out.h,
    media: mediaRefs(items),
    fonts: new Set(fontMap().keys()),
    luts: new Set(listLuts().map((l) => l.id)),
    preset: exportPresetById(presetId)
  })
}

export async function measureFile(path: string): Promise<RenderMeasures> {
  if (!existsSync(path)) throw new Error('Arquivo não encontrado.')
  const info = await probe(path)
  const bin = await ffmpegPath()
  if (!bin) throw new Error('FFmpeg não encontrado.')
  // O log é lido em fluxo: só as linhas dos detectores e o resumo final do ebur128 ficam (vídeos longos geram MBs).
  const kept: string[] = []
  let tail = ''
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(bin, qcAnalysisArgs(path, Boolean(info.hasAudio)), { windowsHide: true })
    let buf = ''
    child.stderr.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) if (QC_LOG_LINE.test(l)) kept.push(l)
      tail = (tail + d.toString()).slice(-6000)
    })
    child.on('error', reject)
    child.on('close', (c) => resolve(c ?? 1))
  })
  if (code !== 0) throw new Error('Não foi possível analisar o arquivo renderizado.')
  return { duration: info.duration ?? 0, width: info.width ?? 0, height: info.height ?? 0, bytes: statSync(path).size, hasAudio: Boolean(info.hasAudio), ...parseQcLog(kept.join('\n'), tail, info.duration ?? undefined) }
}

/** Verifica um arquivo do projeto (versão ou exportação). Sem caminho: a versão mais recente. */
export async function checkProjectRender(projectId: string, opts: { path?: string; presetId?: string } = {}): Promise<{ path: string; items: QcItem[]; measures: RenderMeasures }> {
  requireProject(projectId)
  const versions = listVersions(projectId)
  const path = opts.path ?? versions[versions.length - 1]?.path
  if (!path) throw new Error('Ainda não há versão renderizada: use "Montar versão" antes.')
  if (opts.path && !versions.some((v) => v.path === opts.path)) throw new Error('Esse arquivo não é uma versão deste projeto.')
  const measures = await measureFile(path)
  return { path, items: checkRender(measures, exportPresetById(opts.presetId)), measures }
}
