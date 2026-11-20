export const paperOf = (pages: string): string => `${pages}.pdf`
export const holderOf = (path: string): string | null =>
  /\.pages\.pdf$/i.test(path) ? path.slice(0, -'.pdf'.length) : null
export const pairOf = (path: string): string | null => holderOf(path) ?? (/\.pages$/i.test(path) ? paperOf(path) : null)
