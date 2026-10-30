// Fontes disponíveis no Image Studio: arquivos .ttf/.otf da biblioteca de assets (inclusive as de
// E:\aqc\Modelo edicao\fonts) + fontes comuns do sistema.

export interface FontFile { family: string; weight: number; italic: boolean; path: string }

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700], [/medium/i, 500], [/regular|normal|book/i, 400]
]

/** "BarlowCondensed-ExtraBold.ttf" → Barlow Condensed, 800. */
export function fontFromFile(path: string): FontFile {
  const file = path.split(/[\\/]/).pop()!.replace(/\.(ttf|otf|woff2?)$/i, '')
  const [rawFamily, rawStyle = ''] = file.split(/[-_](?=[^-_]*$)/)
  const style = rawFamily === file ? '' : rawStyle
  let weight = 400
  for (const [re, w] of WEIGHTS) if (re.test(style)) {
    weight = w
    break
  }
  const family = rawFamily.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_]+/g, ' ').trim()
  return { family, weight, italic: /italic|oblique/i.test(style), path }
}

export const SYSTEM_FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Bahnschrift', 'Trebuchet MS', 'Georgia', 'Verdana', 'Tahoma', 'Times New Roman']

/** Fontes script embutidas no app (SIL Open Font License), para títulos manuscritos como "Chefe". */
export const BUNDLED_FONTS = ['Kaushan Script', 'Pacifico']
