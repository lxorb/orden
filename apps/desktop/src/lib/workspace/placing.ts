import { nameFromTitle, shownName } from '../note-name'
import { nameOf } from '../space-paths'
import { invoke, isDesktop, joinPath } from '../tauri'
import { pages } from '../web-tab/pages.svelte'
import { sameSite, settleShortcuts } from '../web-tab/settle'
import { readWebFile, writeShortcut } from '@orden/scan/shortcut'
import type { Entry, Space } from '../workspace.svelte'
import type { ClosedTabs } from './closed.svelte'
import { type NoteDoc, type Tab, UNTITLED } from './documents.svelte'
import { draftFile } from './drafts'
import { writeFile } from './write-file'

export interface Places {
  readonly spaces: readonly Space[]
  readonly activeSpace: Space | null
  readonly closed: ClosedTabs
  freeName(dir: string, wanted: string): string
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  loadTree(): Promise<void>
  remember(path: string): void
  persist(): void
  spaceOf(note: NoteDoc): string | null
  documentAt(path: string): NoteDoc | null
}

export interface PuttingAway extends Places {
  save(tab: Tab): Promise<string | null>
  putAwayDone(tab: Tab, paneId: string, at: number): void
}

export async function putAway(
  ws: PuttingAway,
  tab: Tab,
  paneId: string,
  at: number,
): Promise<void> {
  const path = await ws.save(tab)
  ws.putAwayDone(tab, paneId, at)
  if (path === null) await trashWords(ws, tab.note)
}

type Claim = (path: string, run: () => Promise<NoteDoc | null>) => Promise<NoteDoc | null>

export async function keepWeb(
  ws: Places,
  claim: Claim,
  tab: Tab,
  dir: string,
  file?: string,
): Promise<string | null> {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!canWriteAt(dir)) return null
  const title = file ? shownName(file) : (pages.of(tab.id).title || tab.name || UNTITLED).trim()
  const named = file ?? `${nameFromTitle(title) ?? UNTITLED}.url`
  const page = pages.of(tab.id)
  const url = page.url ?? tab.address ?? ''
  const over = await sameNoteAt(ws, joinPath(dir, named), url)
  let target = over?.path
  while (target === undefined) {
    const name = await ws.freeNameOnDisk(dir, named)
    if (ws.freeName(dir, name) === name) target = joinPath(dir, name)
  }

  const kept = await claim(target, async () => {
    const own = over ? (readWebFile(target, over.text)?.own ?? null) : await ownFor(tab, url)
    const fresh = writeShortcut(url, title, new Date(), undefined, page.kept ?? undefined, own)
    const text = over ? settleShortcuts(target, over.text, fresh, true) : fresh

    if (!over) ws.showEntry(ws.freshEntry(target, false))
    await writeFile(target, text)
    await ws.loadTree()

    tab.note.path = target
    tab.note.name = nameOf(target)
    tab.note.replace(text, false)
    ws.remember(target)
    return tab.note
  })
  if (kept !== tab.note) return null
  return target
}

export async function keepTerm(
  ws: Places & { fileCame(path: string, kind: 'file'): Promise<void> },
  claim: Claim,
  tab: Tab,
  dir: string,
  file?: string,
): Promise<string | null> {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!canWriteAt(dir)) return null
  const name =
    shownName(file ?? tab.name)
      .replace(/[\\/]/g, ' ')
      .trim() || UNTITLED
  let target: string | undefined
  while (target === undefined) {
    const free = await ws.freeNameOnDisk(dir, `${name}.term`)
    if (ws.freeName(dir, free) === free) target = joinPath(dir, free)
  }
  const at = target
  const words = tab.doc
  const kept = await claim(at, async () => {
    ws.showEntry(ws.freshEntry(at, false))
    await writeFile(at, words)
    await ws.fileCame(at, 'file')
    await ws.loadTree()
    tab.note.path = at
    tab.note.name = nameOf(at)
    ws.remember(at)
    return tab.note
  })
  return kept === tab.note ? at : null
}

async function ownFor(tab: Tab, url: string): Promise<string | null> {
  if (!tab.apart) return null
  const { copyingOut, freshOwn, ownStore } = await import('../web-tab/web-data.svelte')
  const own = freshOwn()
  const from = tab.apart
  if (isDesktop) {
    const origins = originOf(url)
    await copyingOut(from, () =>
      invoke('web_copy', {
        from: ownStore(from),
        into: ownStore(own),
        origins: origins ? [origins] : [],
      }),
    ).catch((error: unknown) => {
      console.warn('nib: a saved tab’s web data could not be copied', error)
    })
  }
  return own
}

function originOf(url: string): string | null {
  try {
    const at = new URL(url)
    return at.protocol === 'https:' || at.protocol === 'http:' ? at.origin : null
  } catch {
    return null
  }
}

async function sameNoteAt(
  ws: Places,
  path: string,
  url: string,
): Promise<{ path: string; text: string } | null> {
  if (ws.documentAt(path)) return null

  const text = await invoke<string>('read_note', { path }).catch(() => null)
  const said = text === null ? null : readWebFile(path, text)
  if (text === null || !said || !sameSite(said.home ?? said.url, url)) return null

  return { path, text }
}

export async function trashWords(ws: Places, note: NoteDoc): Promise<void> {
  const own = ws.spaces.find((one) => one.id === note.home) ?? ws.activeSpace
  if (!own) return

  const { canWriteAt } = await import('../sharing.svelte')
  const file = draftFile(note)
  const roots = [own, ws.activeSpace, ...ws.spaces].flatMap((one) => (one ? [one.root] : []))
  const root = roots.find((one) => canWriteAt(joinPath(one, file))) ?? own.root

  const path = joinPath(root, file)
  const entry = await invoke<{ id: string }>('trash_words', { path, content: note.text })
  ws.closed.stack = ws.closed.stack.map((one) =>
    one.draft.share === note.key && one.trashed === undefined ? { ...one, trashed: entry.id } : one,
  )
  ws.persist()
}

export async function untrash(id: string): Promise<boolean> {
  const held = await invoke<unknown>('list_trash').catch(() => null)
  if (!Array.isArray(held)) return true
  if (!held.some((one: { id?: unknown }) => one.id === id)) return false

  await invoke('purge_trash', { id }).catch(() => undefined)
  return true
}
