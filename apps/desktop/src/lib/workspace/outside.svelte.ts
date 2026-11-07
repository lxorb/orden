import { untrack } from 'svelte'
import { links } from '../link-index.svelte'
import { account } from '../account.svelte'
import { keptShaped } from '../internal/roots'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { onUnwatched, type SpaceChange, type SpaceNews, watchSpaces } from '../space-watch'
import { isMarkdownPath, within, withinSpace } from '../space-paths'
import { sync } from '../sync.svelte'
import { type Leadership, leadSync } from '../sync2/lead'
import { invoke } from '../tauri'
import { afterQuiet } from '../timing'
import { landing } from '../views/moving'
import { windows } from '../windows'
import { workspace } from '../workspace.svelte'
import { holdsWords, unixLines } from './documents.svelte'
import type { FileOp } from './file-ops'

const NO_ENGINE = 'no-engine'

function dotted(path: string): boolean {
  const space = workspace.spaces.find((one) => withinSpace(one.root, path) !== null)
  const inside = space ? withinSpace(space.root, path) : null
  return (inside ?? path).split('/').some((part) => part.startsWith('.'))
}

const listAgain = afterQuiet(() => void workspace.loadTree(), 100)

async function lookAt(path: string): Promise<void> {
  await workspace.holdingUnder(path, async () => {
    const note = workspace.documentAt(path)
    if (!note || !holdsWords(note.kind)) return
    const read = await invoke<string>('read_note', { path }).catch(() => null)
    if (read === null) return
    const disk = unixLines(read)
    if (disk === note.onDisk) return
    if (note.dirty || note.live.holdingBack) {
      workspace.owedWords(note)
      return
    }
    note.replace(disk, false)
    links.noteSaved(path, disk)
    windows.say('words', { path, text: disk })
  })
}

async function told(op: FileOp) {
  windows.say('file-op', { op })
  await workspace.fileOps.tell({ ...op, heard: true })
}

const kindOf = (dir: boolean) => (dir ? 'folder' : 'file')

function vanished(path: string, dir: boolean) {
  for (const note of workspace.documents) {
    if (note.path === null || !note.dirty || within(path, note.path) === null) continue
    note.home = workspace.spaceOf(note)
    note.path = null
    note.onDisk = null
    workspace.scheduleSession()
  }
  const op = { op: 'removed', path, kind: kindOf(dir), root: workspace.rootHolding(path) } as const
  workspace.opened.follow(op, (id) => workspace.close(id))
  workspace.closed.follow(op)
  void links.follow(op)
}

async function gone(path: string, dir: boolean) {
  if (await onDisk(path)) return
  vanished(path, dir)
  windows.say('vanished', { path, dir })
  listAgain()
}

async function moved(from: string, to: string, dir: boolean) {
  if (landing(to) || (await onDisk(from))) return
  await told({
    op: 'moved',
    from,
    to,
    kind: kindOf(dir),
    root: workspace.rootHolding(from),
    into: workspace.rootHolding(to),
  })
  listAgain()
}

async function came(path: string, dir: boolean) {
  await told({ op: 'created', path, kind: kindOf(dir), root: workspace.rootHolding(path) })
  listAgain()
}

export async function heardChange(change: SpaceChange): Promise<void> {
  if (dotted(change.path)) return
  if (change.kind === 'removed') return gone(change.path, change.dir)
  if (change.kind === 'renamed') {
    await moved(change.from, change.path, change.dir)
    if (!change.dir) await lookAt(change.path)
    return
  }
  if (change.kind === 'created') await came(change.path, change.dir)
  if (change.dir) return
  if (workspace.documentAt(change.path)) {
    await lookAt(change.path)
    return
  }
  if (isMarkdownPath(change.path)) {
    const read = await invoke<string>('read_note', { path: change.path }).catch(() => null)
    if (read !== null) links.noteSaved(change.path, read)
  }
}

async function lookAtAll(): Promise<void> {
  await Promise.all(workspace.documents.flatMap((one) => one.path ?? []).map(lookAt))
}

let hearing: Promise<void> = Promise.resolve()

export function heardNews(news: SpaceNews): Promise<void> {
  hearing = hearing.then(async () => {
    if (news.unwatched) log('warn', `not all of ${news.root} can be watched: ${news.unwatched}`)
    if (news.gone) return
    for (const change of news.changes) {
      await heardChange(change).catch((error: unknown) => {
        log('error', `outside: ${change.path} - ${String(error)}`)
      })
    }
    if (news.scan) {
      listAgain()
      await lookAtAll()
    }
  })
  return hearing
}

const engineWatches = () => account.user !== null && sync.version === 2

export class TheWatch {
  private giving: AbortController | null = null
  private lead: Leadership | null = null
  private armed: string | null = null

  settle(): void {
    if (engineWatches()) this.letGo()
    else void this.leadAndArm()
  }

  letGoOfByEngine(): void {
    this.armed = null
    this.settle()
  }

  private arm() {
    if (!this.lead || engineWatches()) return
    const roots = workspace.spaces
      .map((one) => one.root)
      .filter((root) => !keptShaped(root))
      .sort()
    const said = JSON.stringify(roots)
    if (said === this.armed) return
    this.armed = said
    void watchSpaces(roots, (news) => void heardNews(news)).catch((error: unknown) => {
      if (this.armed === said) this.armed = null
      log('warn', `outside: the spaces are not watched - ${String(error)}`)
    })
  }

  private letGo() {
    this.giving?.abort()
    this.giving = null
    this.lead?.release()
    this.lead = null
    this.armed = null
  }

  private async leadAndArm() {
    if (this.lead || this.giving) {
      this.arm()
      return
    }
    const mine = new AbortController()
    this.giving = mine
    const got = await leadSync(mine.signal, NO_ENGINE)
    if (this.giving !== mine) {
      got?.release()
      return
    }
    this.giving = null
    this.lead = got
    this.arm()
  }
}

export function hearsUnwatched(
  watch: TheWatch,
  line: {
    say(kind: string): void
    hear(kind: string, listener: () => void): () => unknown
  } = windows,
): () => void {
  const told = onUnwatched(() => {
    watch.letGoOfByEngine()
    line.say('spaces-unwatched')
  })
  const heard = line.hear('spaces-unwatched', () => watch.letGoOfByEngine())
  return () => {
    told()
    heard()
  }
}

export function hearOutside(): void {
  const watch = new TheWatch()
  hearsUnwatched(watch)
  windows.hear('vanished', ({ path, dir }) => {
    vanished(String(path), dir === true)
    listAgain()
  })

  $effect.root(() => {
    $effect(() => {
      void engineWatches()
      void workspace.spaces.map((one) => one.root)
      untrack(() => watch.settle())
    })
  })

  window.addEventListener('focus', () => {
    if (!engineWatches()) void lookAtAll()
  })
}
