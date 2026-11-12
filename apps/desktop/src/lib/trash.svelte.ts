import { account } from './account.svelte'
import { api } from './api'
import { message } from './message'
import { prompt } from './prompt.svelte'
import { canWriteAt } from './sharing.svelte'
import { sync } from './sync.svelte'
import { folderOf, insideSpace, samePath, within } from './space-paths'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

const KEEP_FOR = 14 * 24 * 60 * 60 * 1000

export interface TrashItem {
  id: string
  kind: 'note' | 'folder' | 'space'
  name: string
  detail: string
  deletedAt: number
  purgeAt: number
  source: 'account' | 'device'
  ref: string
  from?: string
}

interface DeviceEntry {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
}

function kindOf(kind: string): TrashItem['kind'] {
  return kind === 'space' || kind === 'folder' ? kind : 'note'
}

class Trash {
  items = $state<TrashItem[]>([])
  busy = $state(false)
  error = $state<string | null>(null)
  loaded = $state(false)

  private asked = 0

  async load() {
    const asked = ++this.asked
    this.error = null
    const token = account.accountToken
    const [found, remote] = await Promise.all([
      this.fromDevice(),
      token ? this.fromAccount(token, asked) : Promise.resolve([]),
    ])
    if (asked !== this.asked) return
    const device =
      remote.length && found.length
        ? await (await import('./trash-doubles')).withoutDoubles(found, this.remoteNotes)
        : found
    if (asked !== this.asked) return
    this.items = [...remote, ...device].sort((a, b) => b.deletedAt - a.deletedAt)
    this.loaded = true
  }

  forgetAccount(): void {
    this.asked++
    this.items = this.items.filter((one) => one.source === 'device')
    this.remoteNotes = []
    this.error = null
  }

  private remoteNotes: { spaceId: string; path: string; deletedAt: number }[] = []

  private async fromDevice(): Promise<TrashItem[]> {
    const entries = await invoke<DeviceEntry[]>('list_trash').catch(() => [] as DeviceEntry[])
    return entries.map((entry) => ({
      id: `device:${entry.id}`,
      ref: entry.id,
      kind: kindOf(entry.kind),
      name: entry.name,
      detail: folderOf(entry.from),
      deletedAt: entry.trashedAt,
      purgeAt: entry.trashedAt + KEEP_FOR,
      source: 'device' as const,
      from: entry.from.replace(/\\/g, '/'),
    }))
  }

  private async fromAccount(token: string, asked: number): Promise<TrashItem[]> {
    let listing: Awaited<ReturnType<typeof api.trash>>
    try {
      listing = await api.trash(token)
    } catch (error) {
      if (asked === this.asked) this.error = message(error, 'could not reach the server')
      return []
    }
    if (asked !== this.asked) return []

    const spaces = listing.spaces.map((space) => ({
      id: `space:${space.id}`,
      ref: space.id,
      kind: 'space' as const,
      name: space.name,
      detail: space.notes === 1 ? '1 note' : `${space.notes} notes`,
      deletedAt: space.deletedAt,
      purgeAt: space.purgeAt,
      source: 'account' as const,
    }))

    this.remoteNotes = listing.notes
    const notes = listing.notes.map((note) => ({
      id: `note:${note.id}`,
      ref: note.id,
      kind: 'note' as const,
      name: note.path.split('/').pop() ?? note.path,
      detail: [note.spaceName, folderOf(note.path)].filter(Boolean).join(' / '),
      deletedAt: note.deletedAt,
      purgeAt: note.purgeAt,
      source: 'account' as const,
    }))

    return [...spaces, ...notes]
  }

  restorable(item: TrashItem): boolean {
    if (item.from === undefined) return true
    const at = whereFrom(item.from)
    return at === null || canWriteAt(at)
  }

  async restore(item: TrashItem) {
    if (!this.restorable(item)) return
    await this.act(async () => {
      if (item.source === 'device') {
        const at = await invoke<string>('restore_trash', { id: item.ref })
        workspace.undone.forget(item.ref)
        await workspace.loadSpaces()
        await workspace.loadTree()
        if (item.kind !== 'space') {
          await workspace.fileCame(
            at,
            item.kind === 'folder' ? 'folder' : 'file',
            undefined,
            item.ref,
          )
        }
        return
      }

      const token = account.accountToken
      if (!token) return
      if (item.kind === 'space') {
        await api.restoreSpace(token, item.ref)
        await account.loadSpaces()
      } else {
        await api.restoreNote(token, item.ref)
      }
      sync.nudge()
    })
  }

  async purge(item: TrashItem) {
    const sure = await prompt.confirm({
      title: `Delete ${item.name}?`,
      confirmLabel: 'Delete now',
      danger: true,
    })
    if (!sure) return

    await this.act(async () => {
      if (item.source === 'device') {
        await invoke('purge_trash', { id: item.ref })
        return
      }

      const token = account.accountToken
      if (!token) return
      if (item.kind === 'space') await api.purgeSpace(token, item.ref)
      else await api.purgeNote(token, item.ref)
    })
  }

  async empty() {
    const sure = await prompt.confirm({
      title: 'Empty Recently deleted?',
      detail: 'Everything in it is gone for good.',
      confirmLabel: 'Empty',
      danger: true,
    })
    if (!sure) return

    await this.act(async () => {
      for (const item of this.items.filter((one) => one.source === 'device')) {
        await invoke('purge_trash', { id: item.ref }).catch(() => undefined)
      }
      if (account.accountToken) await api.emptyTrash(account.accountToken)
    })
  }

  async sweep() {
    await invoke<number>('purge_trash_older_than', { age: KEEP_FOR }).catch(() => 0)
    if (this.loaded) await this.load()
  }

  private async act(work: () => Promise<void>) {
    this.busy = true
    this.error = null
    let failed: string | null = null
    try {
      await work()
    } catch (error) {
      failed = message(error, 'that did not work')
    }

    this.busy = false
    await this.load()
    if (failed !== null) this.error = failed
  }
}

export const trash = new Trash()

account.forgetWithSession(() => trash.forgetAccount())

function whereFrom(from: string): string | null {
  if (from.startsWith('/') || /^[A-Za-z]:[\\/]/.test(from)) return from
  for (const space of workspace.spaces) {
    const path = insideSpace(folderOf(space.root), from)
    if (samePath(path, space.root) || within(space.root, path) !== null) return path
  }
  return null
}
