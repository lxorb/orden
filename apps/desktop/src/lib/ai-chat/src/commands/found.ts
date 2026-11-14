import { links } from '../../../link-index.svelte'
import type { Query } from '@orden/scan/search/query'
import { protection } from '../../../protect/src/api'
import { samePath } from '../../../platform/src/api'
import { workspace } from '../../../workspace.svelte'
import { untrusted } from '../chat/transcript'
import { NOTE_KEYS, type NoteCommand, type NoteKind, rolesOf } from './notes'

const MOST = 500

const ASKED: Query = {
  kind: 'any',
  of: NOTE_KEYS.map((name) => ({ kind: 'property', name, value: null, compare: 'has' })),
}

const held = new Map<string, { version: number; found: NoteCommand[] }>()
const asking = new Map<string, Promise<NoteCommand[]>>()

async function ask(root: string, version: number): Promise<NoteCommand[]> {
  const { searchSpace } = await import('../../../search/src/api')
  const paths = new Set<string>()
  await searchSpace(
    root,
    ASKED,
    [],
    MOST,
    (batch) => {
      for (const hit of batch.hits) if (hit.page === undefined && !hit.tab) paths.add(hit.path)
    },
    workspace.leftOutOf(root),
  )
  const read = await Promise.all(
    [...paths].map(async (path) => {
      const text = await workspace.noteText(path).catch(() => null)
      return text ? rolesOf(path, text) : []
    }),
  )
  const found = read.flat().sort((a, b) => a.name.localeCompare(b.name))
  held.set(root, { version, found })
  return found
}

const readable = (all: NoteCommand[]): NoteCommand[] =>
  protection.any ? all.filter((one) => protection.agentsMay(one.path)) : all

export function foundNow(root = workspace.activeSpace?.root): NoteCommand[] {
  if (!root) return []
  const version = samePath(root, workspace.activeSpace?.root) ? links.version : -1
  const kept = held.get(root)
  if ((version < 0 || kept?.version !== version) && !asking.has(root)) {
    asking.set(
      root,
      ask(root, version)
        .catch(() => [])
        .finally(() => asking.delete(root)),
    )
  }
  return readable(kept?.found ?? [])
}

export async function found(root = workspace.activeSpace?.root): Promise<NoteCommand[]> {
  if (!root) return []
  const now = foundNow(root)
  const asked = asking.get(root)
  return asked ? readable(await asked) : now
}

export async function foundNamed(
  kind: NoteKind,
  name: string,
  root?: string,
): Promise<NoteCommand | null> {
  const wanted = name.trim().toLowerCase()
  return (await found(root)).find((one) => one.kind === kind && one.name === wanted) ?? null
}

export function rootOfSpace(space: string): string | null {
  return workspace.spaces.find((one) => one.id === space)?.root ?? null
}

export async function fromOthers(path: string): Promise<boolean> {
  return (await sharing()).reachedByOthers(path)
}

export async function fromOthersIn(root: string): Promise<boolean> {
  return (await sharing()).reachedByOthersIn(root)
}

let fetched: Promise<typeof import('../../../sharing/src/api')> | null = null
function sharing(): Promise<typeof import('../../../sharing/src/api')> {
  fetched ??= import('../../../sharing/src/api').catch((error: unknown) => {
    fetched = null
    throw error
  })
  return fetched
}

export async function wordsOf(note: NoteCommand | null | undefined): Promise<string> {
  if (!note?.body) return ''
  if (!(await fromOthers(note.path))) return note.body
  return untrusted(note.path, note.body)
}
