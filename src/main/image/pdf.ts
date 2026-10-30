import { inflateSync } from 'node:zlib'
import { trimTransparent, unfilterRows, type RgbaImage } from './png'

// Extrai as imagens embutidas de um PDF (ex.: logo exportada do Canva) com o canal alfa (SMask),
// sem redesenhar nem reamostrar nada — são os pixels originais do arquivo.

interface PdfObject { num: number; dict: string; stream: Buffer | null }

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1')
  const objs = new Map<number, PdfObject>()
  const re = /(\d+)\s+0\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length
    const end = text.indexOf('endobj', start)
    if (end < 0) break
    const body = text.slice(start, end)
    const si = body.search(/\bstream\r?\n/)
    let dict = body
    let stream: Buffer | null = null
    if (si >= 0) {
      dict = body.slice(0, si)
      const dataStart = start + si + body.slice(si).indexOf('\n') + 1
      const ei = text.lastIndexOf('endstream', end)
      let dataEnd = ei
      while (dataEnd > dataStart && (text[dataEnd - 1] === '\n' || text[dataEnd - 1] === '\r')) dataEnd--
      stream = pdf.subarray(dataStart, dataEnd)
    }
    objs.set(Number(m[1]), { num: Number(m[1]), dict, stream })
    re.lastIndex = end
  }
  return objs
}

const num = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)(?!\\s+0\\s+R)`).exec(dict)
  return m ? Number(m[1]) : null
}
const ref = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict)
  return m ? Number(m[1]) : null
}

function decodeStream(obj: PdfObject): Buffer {
  if (!obj.stream) throw new Error('Objeto sem dados')
  const filter = /\/Filter\s*\[?\s*\/(\w+)/.exec(obj.dict)?.[1]
  if (filter && filter !== 'FlateDecode') throw new Error(`Compressão ${filter} não suportada`)
  let data: Buffer = filter ? inflateSync(obj.stream) : Buffer.from(obj.stream)
  const predictor = /\/Predictor\s+(\d+)/.exec(obj.dict)
  if (predictor && Number(predictor[1]) >= 10) {
    const colors = Number(/\/Colors\s+(\d+)/.exec(obj.dict)?.[1] ?? 1)
    const columns = Number(/\/Columns\s+(\d+)/.exec(obj.dict)?.[1] ?? 1)
    const rowBytes = colors * columns
    data = unfilterRows(data, rowBytes, colors, Math.floor(data.length / (rowBytes + 1)))
  }
  return data
}

function components(dict: string, objs: Map<number, PdfObject>): number {
  if (/\/ColorSpace\s*\/DeviceGray/.test(dict)) return 1
  if (/\/ColorSpace\s*\/DeviceRGB/.test(dict)) return 3
  if (/\/ColorSpace\s*\/DeviceCMYK/.test(dict)) return 4
  const icc = /\/ColorSpace\s*\[\s*\/ICCBased\s+(\d+)\s+0\s+R/.exec(dict)
  if (icc) return num(objs.get(Number(icc[1]))?.dict ?? '', 'N') ?? 3
  const csRef = ref(dict, 'ColorSpace')
  if (csRef) return components(`/ColorSpace ${objs.get(csRef)?.dict ?? ''}`, objs)
  return 3
}

export interface ExtractedImage extends RgbaImage {
  /** Número do objeto no PDF (ordem de aparição no arquivo). */
  objectNumber: number
  /** Cor média dos pixels visíveis (ajuda a dizer se é a versão branca ou a colorida). */
  averageColor: [number, number, number]
}

/** Todas as imagens com 8 bits por componente que não são máscaras de outras imagens. */
export function extractPdfImages(pdf: Buffer): ExtractedImage[] {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('O arquivo não é um PDF')
  const objs = parseObjects(pdf)
  const masks = new Set<number>()
  for (const o of objs.values()) {
    const s = ref(o.dict, 'SMask')
    if (s) masks.add(s)
  }
  const out: ExtractedImage[] = []
  for (const o of objs.values()) {
    if (!/\/Subtype\s*\/Image/.test(o.dict) || masks.has(o.num)) continue
    const width = num(o.dict, 'Width')
    const height = num(o.dict, 'Height')
    if (!width || !height || num(o.dict, 'BitsPerComponent') !== 8) continue
    let px: Buffer
    try {
      px = decodeStream(o)
    } catch {
      continue
    }
    const n = components(o.dict, objs)
    if (px.length < width * height * n) continue
    let alpha: Buffer | null = null
    const smaskNum = ref(o.dict, 'SMask')
    const smask = smaskNum ? objs.get(smaskNum) : undefined
    if (smask && num(smask.dict, 'Width') === width && num(smask.dict, 'Height') === height) {
      try {
        alpha = decodeStream(smask)
      } catch {
        alpha = null
      }
    }
    const data = Buffer.alloc(width * height * 4)
    let sr = 0, sg = 0, sb = 0, count = 0
    for (let i = 0; i < width * height; i++) {
      let r: number, g: number, b: number
      if (n === 1) r = g = b = px[i]
      else if (n === 4) {
        const k = px[i * 4 + 3]
        r = 255 - Math.min(255, px[i * 4] + k)
        g = 255 - Math.min(255, px[i * 4 + 1] + k)
        b = 255 - Math.min(255, px[i * 4 + 2] + k)
      } else {
        r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]
      }
      const a = alpha ? alpha[i] : 255
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a
      if (a > 128) {
        sr += r; sg += g; sb += b; count++
      }
    }
    const trimmed = trimTransparent({ width, height, data })
    out.push({
      ...trimmed, objectNumber: o.num,
      averageColor: count ? [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)] : [0, 0, 0]
    })
  }
  return out
}

/** "branca" quando quase todos os pixels visíveis são claros e sem saturação. */
export function looksWhite([r, g, b]: [number, number, number]): boolean {
  return Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 30
}
