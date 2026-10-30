import { Worker } from 'node:worker_threads'
import { createBeatAnalyzer, type BeatAnalysis } from './beats'

// Roda a análise de batidas numa worker thread (FFT de vários minutos de áudio leva segundos e
// travaria o processo principal: IPC, cancelamento e interface ficariam parados).
// O código do analisador vai como texto (createBeatAnalyzer não depende de nada externo),
// então funciona igual no app empacotado e nos testes, sem arquivo de worker separado.

const SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const create = ${createBeatAnalyzer.toString()}
const pcm = new Float32Array(workerData.buffer)
parentPort.postMessage(create().analyzeBeats(pcm, workerData.sr))
`

export function analyzeBeatsInWorker(pcm: Float32Array, sr: number, signal?: AbortSignal): Promise<BeatAnalysis> {
  if (signal?.aborted) return Promise.reject(new Error('Análise cancelada.'))
  // Copia só o trecho usado e transfere o buffer (sem duplicar na memória do worker).
  const copy = pcm.slice()
  const worker = new Worker(SOURCE, { eval: true, workerData: { buffer: copy.buffer, sr }, transferList: [copy.buffer] })
  return new Promise<BeatAnalysis>((resolve, reject) => {
    const abort = (): void => {
      void worker.terminate()
      reject(new Error('Análise cancelada.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (r: BeatAnalysis) => resolve(r))
    worker.once('error', reject)
    worker.once('exit', (code) => {
      signal?.removeEventListener('abort', abort)
      if (code !== 0) reject(new Error('A análise de batidas parou inesperadamente.'))
    })
  }).finally(() => void worker.terminate())
}
