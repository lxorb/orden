import { freePath } from '@orden/markdown/paths'
import { stemOf } from '@orden/markdown/shown'

export const fileNameFor = (name: string, extension: string): string => `${stemOf(name)}.${extension}`
export const freeName = (wanted: string, taken: ReadonlySet<string>): string =>
  freePath(wanted, (candidate) => taken.has(candidate))
export function claimName(wanted: string, taken: Set<string>): string {
  const free = freeName(wanted, taken)
  taken.add(free)
  return free
}
