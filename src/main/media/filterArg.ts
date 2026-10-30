/**
 * Valor de opção de filtro do FFmpeg com caminho de arquivo (ex.: `model=`, `destination=`).
 * O FFmpeg lê duas camadas de escape (ver "Notes on filtergraph escaping" na documentação):
 * 1) a opção do filtro, onde `:` separa opções; 2) o grafo, onde `,` `;` `[` `]` separam filtros.
 * Barras invertidas viram barras normais (aceitas pelo Windows) antes de escapar.
 */
export function filterPath(path: string): string {
  const level1 = path.replace(/\\/g, '/').replace(/[\\':]/g, '\\$&')
  return level1.replace(/[\\'[\],;]/g, '\\$&')
}

/**
 * Texto livre como valor de opção (ex.: `text=` do drawtext com `expansion=none`): as mesmas duas camadas
 * de escape, sem mexer nas barras (o texto é literal).
 */
export function filterText(text: string): string {
  const level1 = text.replace(/[\\':]/g, '\\$&')
  return level1.replace(/[\\'[\],;]/g, '\\$&')
}
