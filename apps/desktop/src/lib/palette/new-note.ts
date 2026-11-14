import { nameFault, nameToWrite, isAgentsName } from '../platform/src/api'

export interface NoteToMake {
  folder: string
  name: string
}

export function noteToMake(term: string): NoteToMake | null {
  const parts = term
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const last = parts.pop()
  if (last === undefined) return null

  const folders = parts.every(
    (part) => nameFault({ typed: part, extension: '', taken: [] }) === null,
  )
  if (!folders || nameFault({ typed: last, extension: '.md', taken: [] })) return null

  return { folder: parts.join('/'), name: nameToWrite(last, '.md') }
}

export function namesAgents(term: string): boolean {
  const last = term
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1)
  return last !== undefined && isAgentsName(nameToWrite(last, '.md'))
}
