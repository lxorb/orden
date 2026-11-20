import type { Entry } from '@orden/contracts'
import { links } from '../../link-index/src/api'
import { invoke, isMarkdownPath } from '../../platform/src/api'
import { copyPath, writeFile } from '../../file-writes/src/api'
import { services } from './services'

interface Leaves {
  entryAt(path: string): Entry | null
  noteText(path: string): Promise<string | null>
  reload(path: string, content: string): void
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
}
export interface Wrote {
  path: string
  before: string
  after: string
}
const notesIn = (entry: Entry): string[] =>
  entry.is_dir ? entry.children.flatMap(notesIn) : isMarkdownPath(entry.path) ? [entry.path] : []
export async function leavingSpace(ws: Leaves, from: string, folder: string, to: string) {
  const back = await services().chatsCarried(from, folder)
  const entry = ws.entryAt(from)
  const along = entry?.is_dir ? from : undefined
  const plans: (Wrote & { carry: { from: string; to: string }[] })[] = []
  for (const note of entry ? notesIn(entry) : isMarkdownPath(from) ? [from] : []) {
    const before = await ws.noteText(note)
    const path = to + note.slice(from.length)
    const left = before === null ? null : await links.leaving(before, note, path, along)
    if (before !== null && left) plans.push({ path, before, after: left.text, carry: left.carry })
  }
  const carry = async (): Promise<{ wrote?: Wrote[] }> => {
    for (const one of plans.flatMap((plan) => plan.carry)) {
      if (await invoke<boolean>('path_exists', { path: one.to }).catch(() => true)) continue
      await copyPath(one.from, one.to).then(
        () => ws.fileCame(one.to, 'file'),
        () => undefined,
      )
    }
    const wrote = plans.filter((plan) => plan.after !== plan.before)
    for (const one of wrote) {
      await writeFile(one.path, one.after)
      ws.reload(one.path, one.after)
    }
    return wrote.length ? { wrote: wrote.map(({ path, before, after }) => ({ path, before, after })) } : {}
  }
  return { back, carry }
}
