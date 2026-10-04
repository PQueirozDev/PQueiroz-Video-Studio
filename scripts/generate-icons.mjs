// Gera os ícones do app e do site a partir de build/icon.svg.
//   build/icon.png (512) · build/icon.ico (16–256) · site/assets/icon.svg · site/assets/icon-192.png
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'))

const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(join(root, 'build', 'icon.png'), render(512))
const ico = await pngToIco([256, 128, 64, 48, 32, 24, 16].map(render))
writeFileSync(join(root, 'build', 'icon.ico'), ico)

const site = join(root, 'site', 'assets')
mkdirSync(site, { recursive: true })
copyFileSync(join(root, 'build', 'icon.svg'), join(site, 'icon.svg'))
writeFileSync(join(site, 'icon-192.png'), render(192))
writeFileSync(join(site, 'icon-512.png'), render(512))
// O mesmo SVG vira a logo dentro do app (barra de título, splash).
const appAssets = join(root, 'src', 'renderer', 'src', 'assets')
mkdirSync(appAssets, { recursive: true })
copyFileSync(join(root, 'build', 'icon.svg'), join(appAssets, 'icon.svg'))
console.log('ícones gerados')
