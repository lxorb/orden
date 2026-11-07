import { sameSpelling } from '../space-paths'
import { isRecord, isString } from '../stored'
import { internal, invoke, isDesktop } from '../tauri'
import type { Entry, TreeOptions } from '../workspace.svelte'

export interface Plan {
  root: string | null
  options: TreeOptions
  notes: string[]
  web: boolean
}

interface Answer {
  plan: Plan
  spaces: { name: string; path: string }[] | null
  tree: Entry | null
  notes: Map<string, string>
}

function answerOf(value: unknown): Answer | null {
  if (!isRecord(value) || !isRecord(value.plan)) return null

  const { root, options, notes } = value.plan
  const words = isRecord(value.notes) ? value.notes : {}

  return {
    plan: {
      root: isString(root) ? root : null,
      options: { showHidden: isRecord(options) && options.showHidden === true },
      notes: Array.isArray(notes) ? notes.filter(isString) : [],
      web: value.plan.web === true,
    },
    spaces: Array.isArray(value.spaces) ? (value.spaces as Answer['spaces']) : null,
    tree: isRecord(value.tree) ? (value.tree as unknown as Entry) : null,
    notes: new Map(
      Object.entries(words).flatMap(([path, text]) => (isString(text) ? [[path, text]] : [])),
    ),
  }
}

let answer: Promise<Answer | null> | null = null

function received(): Promise<Answer | null> {
  answer ??= Promise.resolve(
    (window as unknown as { ordenEarly?: Promise<unknown> }).ordenEarly ?? null,
  ).then(answerOf, () => null)
  return answer
}

const asked = () => typeof window !== 'undefined' && isDesktop

export async function spacesAhead(): Promise<{ name: string; path: string }[] | null> {
  if (!asked()) return null

  const got = await received()
  const spaces = got?.spaces ?? null
  if (got) got.spaces = null
  return spaces
}

export async function treeAhead(root: string, options: TreeOptions): Promise<Entry | null> {
  if (!asked()) return null
  if (internal.routed?.('read_tree', { root })) return null

  const got = await received()
  const read = got?.plan.root
  if (!got?.tree || !read || !sameSpelling(read, root)) return null
  if (got.plan.options.showHidden !== options.showHidden) return null

  const tree = got.tree
  got.tree = null
  return tree
}

export async function noteAhead(path: string): Promise<string | null> {
  if (!asked()) return null

  const got = await received()
  const words = got?.notes.get(path) ?? null
  got?.notes.delete(path)
  return words
}

export async function noteAheadPeek(path: string): Promise<string | null> {
  if (!asked()) return null
  return (await received())?.notes.get(path) ?? null
}

export function forgetAhead(): void {
  answer = Promise.resolve(null)
}

let written = ''

export function plan(next: Plan): void {
  if (!asked()) return

  const said = JSON.stringify(next)
  if (said === written) return
  written = said
  invoke('remember_launch', { plan: next }).catch(() => {
    written = ''
  })
}
