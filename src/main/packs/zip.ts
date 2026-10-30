import { closeSync, openSync, readSync, fstatSync, writeFileSync } from 'node:fs'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

// Leitor/escritor mínimo de ZIP (métodos "stored" e "deflate"), suficiente para os pacotes .pqs-pack.
// Feito à mão para não depender de bibliotecas: lê o diretório central, recusa entradas criptografadas,
// ZIP64, nomes perigosos (absolutos, "..") e limita tamanho total, quantidade e taxa de compressão.

export interface ZipEntry {
  name: string
  size: number
  compressedSize: number
  method: number
  offset: number
  crc: number
}

export interface ZipLimits {
  maxEntries: number
  maxTotal: number
  /** Tamanho descompactado / compactado máximo por entrada (defesa contra "zip bomb"). */
  maxRatio: number
}

export const DEFAULT_LIMITS: ZipLimits = { maxEntries: 5000, maxTotal: 2 * 1024 ** 3, maxRatio: 200 }
/** Cada arquivo é lido inteiro na memória: limite por entrada e para o diretório central. */
export const MAX_ENTRY = 512 * 1024 * 1024
const MAX_CD = 16 * 1024 * 1024

function readAt(fd: number, pos: number, len: number): Buffer {
  const buf = Buffer.alloc(len)
  let done = 0
  while (done < len) {
    const n = readSync(fd, buf, done, len - done, pos + done)
    if (n <= 0) throw new Error('Arquivo ZIP truncado.')
    done += n
  }
  return buf
}

/** Nome de entrada seguro (barras normais, sem absoluto, sem "..", sem caracteres proibidos no Windows). */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/')
  if (!name || name.length > 240 || name.startsWith('/') || /^[a-z]:/i.test(name)) return null
  const parts = name.replace(/\/$/, '').split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p))) return null
  return name
}

export class ZipReader {
  readonly entries: ZipEntry[] = []
  private fd: number

  constructor(path: string, limits: ZipLimits = DEFAULT_LIMITS) {
    this.fd = openSync(path, 'r')
    try {
      const size = fstatSync(this.fd).size
      // Fim do diretório central: assinatura 0x06054b50 nos últimos 64 KiB + 22 bytes.
      const tailLen = Math.min(size, 65557)
      const tail = readAt(this.fd, size - tailLen, tailLen)
      let eocd = -1
      for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
      if (eocd < 0) throw new Error('Não é um arquivo ZIP válido.')
      const count = tail.readUInt16LE(eocd + 10)
      const cdSize = tail.readUInt32LE(eocd + 12)
      const cdOffset = tail.readUInt32LE(eocd + 16)
      if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 não é suportado.')
      if (count > limits.maxEntries) throw new Error(`O pacote tem arquivos demais (máximo ${limits.maxEntries}).`)
      if (cdOffset + cdSize > size || cdSize > MAX_CD) throw new Error('ZIP corrompido ou com diretório grande demais.')
      const cd = readAt(this.fd, cdOffset, cdSize)
      let p = 0
      let total = 0
      for (let i = 0; i < count; i++) {
        if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP corrompido (diretório central).')
        const flags = cd.readUInt16LE(p + 8)
        const method = cd.readUInt16LE(p + 10)
        const crc = cd.readUInt32LE(p + 16)
        const compressedSize = cd.readUInt32LE(p + 20)
        const sz = cd.readUInt32LE(p + 24)
        const nameLen = cd.readUInt16LE(p + 28)
        const extraLen = cd.readUInt16LE(p + 30)
        const commentLen = cd.readUInt16LE(p + 32)
        const offset = cd.readUInt32LE(p + 42)
        const rawName = cd.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
        p += 46 + nameLen + extraLen + commentLen
        if (flags & 0x1) throw new Error('Pacotes com senha não são suportados.')
        if (method !== 0 && method !== 8) throw new Error(`Compressão não suportada em "${rawName}".`)
        const name = safeEntryName(rawName)
        if (!name) throw new Error(`Nome de arquivo inseguro no pacote: "${rawName}".`)
        if (name.endsWith('/')) continue
        // Tudo que o cabeçalho declara precisa caber no arquivo real, antes de qualquer leitura.
        if (sz > MAX_ENTRY) throw new Error(`"${name}" é grande demais para um pacote (máximo 512 MB por arquivo).`)
        if (offset + 30 + compressedSize > size) throw new Error(`ZIP corrompido em "${name}".`)
        if (method === 0 && compressedSize !== sz) throw new Error(`ZIP corrompido em "${name}".`)
        total += sz
        if (total > limits.maxTotal) throw new Error('O pacote descompactado passa do limite de tamanho.')
        if (compressedSize > 0 && sz / compressedSize > limits.maxRatio && sz > 10 * 1024 * 1024) throw new Error(`Compressão suspeita em "${name}".`)
        this.entries.push({ name, size: sz, compressedSize, method, offset, crc })
      }
    } catch (err) {
      closeSync(this.fd)
      throw err
    }
  }

  read(entry: ZipEntry): Buffer {
    const head = readAt(this.fd, entry.offset, 30)
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP corrompido (cabeçalho local).')
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
    if (start + entry.compressedSize > fstatSync(this.fd).size) throw new Error(`ZIP corrompido em "${entry.name}".`)
    const raw = readAt(this.fd, start, entry.compressedSize)
    const data = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: entry.size + 1 })
    if (data.length !== entry.size) throw new Error(`Tamanho incorreto em "${entry.name}".`)
    if ((crc32(data) >>> 0) !== entry.crc) throw new Error(`Arquivo corrompido no pacote: "${entry.name}".`)
    return data
  }

  close(): void {
    closeSync(this.fd)
  }
}

/** Cria um ZIP com os arquivos dados (nome no zip → conteúdo). Comprime o que vale a pena. */
export function writeZip(path: string, files: { name: string; data: Buffer }[]): void {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = safeEntryName(f.name)
    if (!name) throw new Error(`Nome inválido para o pacote: ${f.name}`)
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(f.data, { level: 6 })
    // Sem deflate quando a taxa passaria do limite do leitor (o app tem que conseguir instalar o que exporta).
    const ratioOk = f.data.length <= 10 * 1024 * 1024 || f.data.length / Math.max(1, deflated.length) <= DEFAULT_LIMITS.maxRatio
    if (f.data.length > MAX_ENTRY) throw new Error(`Arquivo grande demais para o pacote: ${f.name}`)
    const useDeflate = ratioOk && deflated.length < f.data.length * 0.95
    const body = useDeflate ? deflated : f.data
    const crc = crc32(f.data) >>> 0
    if (offset + body.length > 0xfffffff0) throw new Error('Pacote grande demais (limite de 4 GB).')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x800, 8)
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(f.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    chunks.push(local, nameBuf, body)
    central.push(cd, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(path, Buffer.concat([...chunks, cdBuf, end]))
}
