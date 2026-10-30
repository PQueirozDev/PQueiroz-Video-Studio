import { deflateSync, inflateSync } from 'node:zlib'

// Codificador/decodificador PNG mínimo (RGBA 8 bits), sem dependências nativas.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export interface RgbaImage {
  width: number
  height: number
  /** RGBA, 4 bytes por pixel, linha a linha. */
  data: Buffer
}

export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profundidade
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Desfaz os filtros de linha do PNG (também usados pelo Predictor ≥ 10 do PDF). */
export function unfilterRows(src: Buffer, rowBytes: number, bpp: number, rows: number): Buffer {
  const out = Buffer.alloc(rowBytes * rows)
  for (let y = 0; y < rows; y++) {
    const f = src[y * (rowBytes + 1)]
    const inOff = y * (rowBytes + 1) + 1
    const o = y * rowBytes
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0
      const b = y > 0 ? out[o - rowBytes + x] : 0
      const c = x >= bpp && y > 0 ? out[o - rowBytes + x - bpp] : 0
      let v = src[inOff + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[o + x] = v & 0xff
    }
  }
  return out
}

/** Lê PNGs RGBA/RGB/Gray de 8 bits sem entrelaçamento (o que o estúdio e o Canva produzem). */
export function decodePng(buf: Buffer): RgbaImage {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Não é um PNG')
  let pos = 8
  let width = 0, height = 0, colorType = 0, depth = 0, interlace = 0
  const idat: Buffer[] = []
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8 || interlace) throw new Error('PNG não suportado (use 8 bits sem entrelaçamento)')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error('Tipo de cor PNG não suportado')
  const px = unfilterRows(inflateSync(Buffer.concat(idat)), width * channels, channels, height)
  const out = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    let r: number, g: number, b: number, a = 255
    if (colorType === 3) {
      const idx = px[s]
      r = palette![idx * 3]; g = palette![idx * 3 + 1]; b = palette![idx * 3 + 2]
      if (trns && idx < trns.length) a = trns[idx]
    } else if (channels <= 2) {
      r = g = b = px[s]
      if (channels === 2) a = px[s + 1]
    } else {
      r = px[s]; g = px[s + 1]; b = px[s + 2]
      if (channels === 4) a = px[s + 3]
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a
  }
  return { width, height, data: out }
}

/** Recorta as bordas transparentes (sem reamostrar: proporções e pixels originais intactos). */
export function trimTransparent(img: RgbaImage, threshold = 8): RgbaImage {
  const { width, height, data } = img
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return img
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) data.copy(out, y * w * 4, ((y + y0) * width + x0) * 4, ((y + y0) * width + x1 + 1) * 4)
  return { width: w, height: h, data: out }
}
