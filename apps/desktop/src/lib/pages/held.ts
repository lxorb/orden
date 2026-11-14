import { isPagesTarget } from '@orden/markdown/links'
import { placesOf, samePath } from '../platform/src/api'

export function paperOf(pages: string): string {
  return `${pages}.pdf`
}

export function holderOf(path: string): string | null {
  return /\.pages\.pdf$/i.test(path) ? path.slice(0, -'.pdf'.length) : null
}

export function pairOf(path: string): string | null {
  return holderOf(path) ?? (/\.pages$/i.test(path) ? paperOf(path) : null)
}

export function paperPlaces(file: string, note: string | null, root: string | null): string[] {
  const named = placesOf(file, note, root)
  if (!named.length || !note || !isPagesTarget(note)) return named

  const own = paperOf(note)
  return [own, ...named.filter((one) => !samePath(one, own))]
}
