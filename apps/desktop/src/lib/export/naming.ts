import { freePath } from '@orden/markdown/paths'

export function stemOf(name: string): string {
  return name.replace(/\.(?=[^./\\\s]*\p{L})[^./\\\s]+$/u, '')
}

export function fileNameFor(name: string, extension: string): string {
  return `${stemOf(name)}.${extension}`
}

export function freeName(wanted: string, taken: ReadonlySet<string>): string {
  return freePath(wanted, (candidate) => taken.has(candidate))
}

export function claimName(wanted: string, taken: Set<string>): string {
  const free = freeName(wanted, taken)
  taken.add(free)
  return free
}
