import { foldName } from '@orden/markdown/links'
import { endingOf, isAgentsName, isReserved } from './note-name'

export { isReserved }

export type NameFault =
  'empty' | 'separator' | 'illegal' | 'trailing' | 'reserved' | 'agents' | 'taken'

const ILLEGAL = /[<>:"|?*]/

const SEPARATOR = /[\\/]/

const CONTROL = /\p{Cc}/u

export interface Naming {
  typed: string
  extension: string
  taken: readonly string[]
  current?: string | undefined
}

export function nameFault({ typed, extension, taken, current }: Naming): NameFault | null {
  const name = typed.trim()

  if (!name) return 'empty'
  if (SEPARATOR.test(name)) return 'separator'
  if (ILLEGAL.test(name) || CONTROL.test(name)) return 'illegal'
  if (name.endsWith('.')) return 'trailing'
  if (isReserved(name)) return 'reserved'
  if (isAgentsName(nameToWrite(name, extension)) && !(current && isAgentsName(current))) {
    return 'agents'
  }

  const written = foldName(nameToWrite(name, extension))
  const paired = written.replace(/\.pages(\.pdf)?$/i, (_, pdf) => (pdf ? '.pages' : '.pages.pdf'))
  return taken.some((one) => [written, paired].includes(foldName(one))) ? 'taken' : null
}

export function nameToWrite(typed: string, extension: string): string {
  const name = typed.trim()
  if (!extension) return name
  if (!name.toLowerCase().endsWith(extension.toLowerCase())) return name + extension

  return name.slice(0, name.length - extension.length) + extension
}

export function extensionOf(name: string, isFolder: boolean): string {
  if (isFolder) return ''
  return endingOf(name) ?? '.md'
}

export function nameToCommit(
  naming: Naming & { was: string; current?: string | undefined },
): string | null {
  if (nameFault(naming)) return null
  if (naming.typed.trim() === naming.was.trim()) return null

  const name = nameToWrite(naming.typed, naming.extension)
  return name === (naming.current ?? nameToWrite(naming.was, naming.extension)) ? null : name
}
