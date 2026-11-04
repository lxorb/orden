/** What other programs do in the space folders, heard where no sync engine hears it.
 *
 *  The crate's watch of the spaces (src-tauri/src/space_watch.rs) was started by the sync
 *  engine alone, because it was written as the road a foreign edit takes into sync. So
 *  signed out - or on the first engine - a `git pull` in Orden's own terminal, Claude Code
 *  writing a note, VS Code or Obsidian went unheard: the tab kept the words from when it
 *  was opened, the list kept the rows, and the next key put the old words back.
 *
 *  Nothing in the watch needs an account. What it costs is the engine's cost: one listing
 *  of each space on a thread of its own as it starts, a `stat` per root every two seconds,
 *  a read per file that changes while it is open, and a system watch a folder on Linux, a
 *  limit being reached costing only what is past it. Signed in on the second engine this
 *  stays out of the way: the crate has one watch and a second would replace the engine's.
 *  Among windows the one holding `leadSync`'s lock watches, as for the engine, and says
 *  what it hears to the others in the words they hear each other in (across.ts).
 *
 *  - A file that changed under a clean tab: the tab reads it, keeping its carets, as a note
 *    a sync brought over does.
 *  - Under a tab with words waiting: the write is hurried, and takes the file in first;
 *    see `attempt` in across.ts. That is also what holds whenever nothing was heard, past
 *    the system's limit or within the watch's quiet moment.
 *  - A file gone: a clean tab closes, and unwritten words stay as a draft. Nothing else
 *    forgets it, since `git switch` and back is a file gone and come back; see `vanished`.
 *  - A file moved: everything kept by path follows, as for a move in another window.
 *
 *  Nothing here tells the account: `heard` says it was done elsewhere. And what Orden did
 *  itself comes back too: a write finds nothing new, a delete asks the disk, and a move
 *  changes nothing that has already followed it. */

import { untrack } from 'svelte'
import { links } from '../link-index.svelte'
import { account } from '../account.svelte'
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
import { holdsWords } from './documents.svelte'
import type { FileOp } from './file-ops'

/** The lock's name beside the accounts': no engine runs under it. */
const NO_ENGINE = 'no-engine'

const unixLines = (text: string) => text.replace(/\r\n?/g, '\n')

/** Whether a path is the app's own: as the engine's watch has it (`hidden` in
 *  sync2/watching.ts), past the space it is in. */
function dotted(path: string): boolean {
  const space = workspace.spaces.find((one) => withinSpace(one.root, path) !== null)
  const inside = space ? withinSpace(space.root, path) : null
  return (inside ?? path).split('/').some((part) => part.startsWith('.'))
}

const listAgain = afterQuiet(() => void workspace.loadTree(), 100)

/** The note open at `path` against what the file says now. */
async function lookAt(path: string): Promise<void> {
  await workspace.holdingUnder(path, async () => {
    const note = workspace.documentAt(path)
    if (!note || !holdsWords(note.kind)) return
    const read = await invoke<string>('read_note', { path }).catch(() => null)
    if (read === null) return
    const disk = unixLines(read)
    if (disk === note.onDisk) return
    // From here to the note holding it nothing waits, so no key can land in between.
    if (note.dirty || note.live.holdingBack) {
      workspace.owedWords(note)
      return
    }
    note.replace(disk, false)
    links.noteSaved(path, disk)
    windows.say('words', { path, text: disk })
  })
}

/** Says an operation here and to the other windows, none of it done by anyone here. */
async function told(op: FileOp) {
  windows.say('file-op', { op })
  await workspace.fileOps.tell({ ...op, heard: true })
}

/** A file not there any more, by another program's doing, which may be `git switch` and
 *  back in a moment. So not a delete told to everything kept by path, which forgets its
 *  icon, its place in an order, what it leaves out and a paper's words for good: only what
 *  shows it goes. Its tab can be reopened, unwritten words stay as a draft, and the index
 *  reads it again when it comes back. */
function vanished(path: string, kind: 'file' | 'folder') {
  for (const note of workspace.documents) {
    if (note.path === null || !note.dirty || within(path, note.path) === null) continue
    note.home = workspace.spaceOf(note)
    note.path = null
    note.onDisk = null
    workspace.scheduleSession()
  }
  const op = { op: 'removed', path, kind, root: workspace.rootHolding(path) } as const
  workspace.opened.follow(op, (id) => workspace.close(id))
  workspace.closed.follow(op)
  void links.follow(op)
}

async function gone(path: string, dir: boolean) {
  // A note deleted and put straight back is said to be deleted after it is back.
  if (await onDisk(path)) return
  vanished(path, dir ? 'folder' : 'file')
  windows.say('vanished', { path, dir })
  listAgain()
}

async function moved(from: string, to: string, dir: boolean) {
  // One of the workspace's under way is told when its links have been rewritten, which
  // finding what pointed at the old name needs done first. One told already changes nothing
  // kept by path, and the steps of undo know their own; see workspace/undo-moved.ts.
  if (landing(to) || (await onDisk(from))) return
  await told({
    op: 'moved',
    from,
    to,
    kind: dir ? 'folder' : 'file',
    root: workspace.rootHolding(from),
    into: workspace.rootHolding(to),
  })
  listAgain()
}

async function came(path: string, dir: boolean) {
  await told({
    op: 'created',
    path,
    kind: dir ? 'folder' : 'file',
    root: workspace.rootHolding(path),
  })
  listAgain()
}

/** What one answer of the crate's means here. */
export async function heardChange(change: SpaceChange): Promise<void> {
  if (dotted(change.path)) return
  switch (change.kind) {
    case 'removed':
      await gone(change.path, change.dir)
      return
    case 'renamed':
      await moved(change.from, change.path, change.dir)
      if (!change.dir) await lookAt(change.path)
      return
    case 'created':
      await came(change.path, change.dir)
      break
    case 'modified':
      break
  }
  if (change.dir) return
  if (workspace.documentAt(change.path)) {
    await lookAt(change.path)
    return
  }
  // Nothing has it open, and the index knows a note only by what it was last told.
  if (isMarkdownPath(change.path)) {
    const read = await invoke<string>('read_note', { path: change.path }).catch(() => null)
    if (read !== null) links.noteSaved(change.path, read)
  }
}

/** Every open note against its file: the watch starting, it having lost track, and the
 *  window coming back, which is all there is past the system's limit of watched folders. */
export async function lookAtAll(): Promise<void> {
  const paths = workspace.documents.flatMap((one) => one.path ?? [])
  await Promise.all(paths.map((path) => lookAt(path)))
}

/** One message at a time, in the order said. */
let hearing: Promise<void> = Promise.resolve()

export function heardNews(news: SpaceNews): Promise<void> {
  hearing = hearing.then(async () => {
    if (news.unwatched) log('warn', `not all of ${news.root} can be watched: ${news.unwatched}`)
    // Never a reason to delete anything; see space-watch.ts.
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

/** Whether the sync engine is the one to watch: it has the account and its first pass. */
const engineWatches = () => account.user !== null && sync.version === 2

/** Who runs the watch, as things stand. */
export class TheWatch {
  private giving: AbortController | null = null
  private lead: Leadership | null = null
  private armed: string | null = null

  /** Watches what is there to watch, or leaves it to the engine. */
  settle(): void {
    if (engineWatches()) this.letGo()
    else void this.leadAndArm()
  }

  /** The engine let go of the one watch, as signing out ends. */
  letGoOfByEngine(): void {
    this.armed = null
    this.settle()
  }

  private arm() {
    if (!this.lead || engineWatches()) return
    const roots = workspace.spaces.map((one) => one.root).sort()
    const said = JSON.stringify(roots)
    if (said === this.armed) return
    this.armed = said
    // A root the crate refuses refuses the lot, and a change of spaces asks again.
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

/** The engine let go of the one watch, here or in another window: the crate's watch is the
 *  whole app's, and the window that could take it up is not the one signing out's. Answers
 *  the way to stop hearing. */
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

/** Started once, at the launch's turn for it, on the desktop. */
export function hearOutside(): void {
  const watch = new TheWatch()
  hearsUnwatched(watch)
  windows.hear('vanished', ({ path, dir }) => {
    vanished(String(path), dir === true ? 'folder' : 'file')
    listAgain()
  })

  $effect.root(() => {
    $effect(() => {
      // Read for the effect: signing in or out, and a space made, renamed or deleted,
      // which is a watch of other roots.
      void engineWatches()
      void workspace.spaces.map((one) => one.root)
      untrack(() => watch.settle())
    })
  })

  window.addEventListener('focus', () => {
    if (!engineWatches()) void lookAtAll()
  })
}
