import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SpaceChange, SpaceNews } from '../space-watch'
import { InternalFolder } from './folder'
import { MemoryBytes } from './memory'
import { carried, Mirror, type WorkDisk, workFolderOf } from './work'

vi.mock('../crate/src/native', () => ({ invoke: () => Promise.resolve(null) }))

const ROOT = '/spaces/.orden/.work/Notes'

const text = (bytes: Uint8Array | null | undefined) =>
  bytes ? new TextDecoder().decode(bytes) : null

class Disk implements WorkDisk {
  readonly root = ROOT
  readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>()
  readonly dirs = new Set<string>()
  seen: string | null = null
  writes = 0
  private clock = 5000
  private heard: ((news: SpaceNews) => void) | null = null

  private tell(changes: SpaceChange[]) {
    const heard = this.heard
    if (heard) queueMicrotask(() => heard({ root: ROOT, changes, scan: false, gone: false }))
  }

  private listed(rel: string) {
    const file = this.files.get(rel)
    return {
      path: `${ROOT}/${rel}`,
      dir: !file,
      size: file?.bytes.byteLength ?? 0,
      mtime: file?.mtime ?? 0,
      id: null,
    }
  }

  put(rel: string, words: string, told = true) {
    const had = this.files.has(rel)
    this.files.set(rel, { bytes: new TextEncoder().encode(words), mtime: (this.clock += 7) })
    if (told) this.tell([{ kind: had ? 'modified' : 'created', ...this.listed(rel) }])
  }

  drop(rel: string, told = true) {
    this.files.delete(rel)
    if (told) this.tell([{ kind: 'removed', path: `${ROOT}/${rel}`, dir: false, id: null }])
  }

  move(from: string, to: string) {
    const file = this.files.get(from)
    if (!file) throw new Error(`nothing at ${from}`)
    this.files.delete(from)
    this.files.set(to, file)
    this.tell([{ kind: 'renamed', from: `${ROOT}/${from}`, ...this.listed(to) }])
  }

  list() {
    return Promise.resolve([...this.dirs, ...this.files.keys()].map((rel) => this.listed(rel)))
  }

  read(rel: string) {
    return Promise.resolve(this.files.get(rel)?.bytes ?? null)
  }

  write(rel: string, bytes: Uint8Array) {
    this.writes += 1
    const had = this.files.has(rel)
    this.files.set(rel, { bytes, mtime: (this.clock += 7) })
    this.tell([{ kind: had ? 'modified' : 'created', ...this.listed(rel) }])
    return this.stamp(rel)
  }

  stamp(rel: string) {
    const file = this.files.get(rel)
    return Promise.resolve(file ? { size: file.bytes.byteLength, mtime: file.mtime } : null)
  }

  isDir(rel: string) {
    return Promise.resolve(this.dirs.has(rel))
  }

  mkdir(rel: string) {
    if (rel) this.dirs.add(rel)
    return Promise.resolve()
  }

  remove(rel: string, dir: boolean) {
    if (dir) this.dirs.delete(rel)
    else this.files.delete(rel)
    return Promise.resolve()
  }

  rename(from: string, to: string) {
    const file = this.files.get(from)
    if (file) {
      this.files.delete(from)
      this.files.set(to, file)
    }
    return this.stamp(to)
  }

  watch(heard: (news: SpaceNews) => void) {
    this.heard = heard
    return Promise.resolve(() => {
      this.heard = null
    })
  }

  loadSeen() {
    return Promise.resolve(this.seen)
  }

  saveSeen(words: string) {
    this.seen = words
    return Promise.resolve()
  }
}

const open: InternalFolder[] = []

afterEach(() => {
  for (const one of open.splice(0)) one.close()
})

async function store(bytes = new MemoryBytes()) {
  let keys = 0
  let clock = 1000
  const folder = await InternalFolder.open('/spaces/.orden/Notes', bytes, {
    now: () => (clock += 1),
    key: () => `k${String((keys += 1))}`,
    foldsCase: false,
  })
  open.push(folder)
  return folder
}

async function idle(mirror: Mirror) {
  for (let turn = 0; turn < 6; turn += 1) {
    await new Promise((later) => setTimeout(later, 0))
    await mirror.settled()
  }
}

async function started(folder: InternalFolder, disk = new Disk()) {
  const mirror = new Mirror(folder, disk)
  await mirror.start()
  await idle(mirror)
  return { mirror, disk }
}

const words = async (folder: InternalFolder, path: string) =>
  (await folder.readText(path)) ?? text(await folder.read(path))

describe("a kept space's working folder", () => {
  test('sits beside the kept folder, named as the space', () => {
    expect(workFolderOf('/spaces/.orden/Notes')).toBe('/spaces/.orden/.work/Notes')
    expect(workFolderOf('C:\\Orden\\.orden\\Notes\\')).toBe('C:\\Orden\\.orden\\.work\\Notes')
  })

  test("holds the space's files and its inbox, and nothing else of Orden's", async () => {
    const folder = await store()
    await folder.write('Lists/Plan.md', 'ship it')
    await folder.write('cat.png', new Uint8Array([1, 2]))
    await folder.write('.Inbox.md', '- [ ] milk\n')
    await folder.write('.obsidian/app.json', '{}')
    await folder.mkdir('Empty')

    const { disk } = await started(folder)

    expect(text(disk.files.get('Lists/Plan.md')?.bytes)).toBe('ship it')
    expect([...(disk.files.get('cat.png')?.bytes ?? [])]).toEqual([1, 2])
    expect(text(disk.files.get('.Inbox.md')?.bytes)).toBe('- [ ] milk\n')
    expect(disk.files.has('.obsidian/app.json')).toBe(false)
    expect(disk.dirs.has('Empty')).toBe(true)
    expect(carried('.obsidian/app.json')).toBe(false)
    expect(carried('Lists/~$Plan.docx')).toBe(false)
  })

  test('what a terminal writes there comes into the store, and what the app writes goes out, once', async () => {
    const bytes = new MemoryBytes()
    const folder = await store(bytes)
    await folder.write('Plan.md', 'one')
    const { mirror, disk } = await started(folder)
    const key = (await folder.at('Plan.md'))?.key

    disk.put('Plan.md', 'two')
    await idle(mirror)
    expect(await folder.readText('Plan.md')).toBe('two')
    expect((await folder.at('Plan.md'))?.key).toBe(key)

    const out = disk.writes
    const into = bytes.writes
    await folder.write('Plan.md', 'three')
    await idle(mirror)
    expect(text(disk.files.get('Plan.md')?.bytes)).toBe('three')
    expect(disk.writes).toBe(out + 1)
    expect(bytes.writes).toBe(into + 1)
  })

  test('a file made, renamed and removed there is made, moved under its key and removed in the store', async () => {
    const folder = await store()
    const { mirror, disk } = await started(folder)

    disk.put('Draft.md', 'words')
    await idle(mirror)
    expect(await folder.readText('Draft.md')).toBe('words')
    const key = (await folder.at('Draft.md'))?.key

    disk.move('Draft.md', 'Done/Final.md')
    await idle(mirror)
    expect(await folder.at('Draft.md')).toBeNull()
    expect((await folder.at('Done/Final.md'))?.key).toBe(key)

    disk.drop('Done/Final.md')
    await idle(mirror)
    expect(await folder.at('Done/Final.md')).toBeNull()
  })

  test('a file the app renames or removes is renamed or removed there', async () => {
    const folder = await store()
    await folder.write('Old.md', 'kept')
    await folder.write('Gone.md', 'bye')
    const { mirror, disk } = await started(folder)

    await folder.move('Old.md', 'New.md')
    await folder.remove('Gone.md')
    await idle(mirror)

    expect([...disk.files.keys()]).toEqual(['New.md'])
    expect(text(disk.files.get('New.md')?.bytes)).toBe('kept')
  })

  test('what changed on either side while nothing watched is carried over at the next start', async () => {
    const folder = await store()
    await folder.write('Mine.md', 'one')
    await folder.write('Theirs.md', 'one')
    await folder.write('Removed.md', 'one')
    const first = await started(folder)
    await first.mirror.stop()
    const disk = first.disk

    disk.put('Mine.md', 'edited in a terminal', false)
    disk.put('Made.md', 'new in a terminal', false)
    await folder.write('Theirs.md', 'edited in the app')
    await folder.remove('Removed.md')

    await started(folder, disk)

    expect(await words(folder, 'Mine.md')).toBe('edited in a terminal')
    expect(await words(folder, 'Made.md')).toBe('new in a terminal')
    expect(text(disk.files.get('Theirs.md')?.bytes)).toBe('edited in the app')
    expect(disk.files.has('Removed.md')).toBe(false)
    expect(await folder.at('Removed.md')).toBeNull()
  })

  test('a file deleted there while nothing watched is deleted in the store, unless the app changed it since', async () => {
    const folder = await store()
    await folder.write('Quiet.md', 'one')
    await folder.write('Busy.md', 'one')
    const first = await started(folder)
    await first.mirror.stop()

    first.disk.drop('Quiet.md', false)
    first.disk.drop('Busy.md', false)
    await folder.write('Busy.md', 'two')

    await started(folder, first.disk)

    expect(await folder.at('Quiet.md')).toBeNull()
    expect(await folder.readText('Busy.md')).toBe('two')
    expect(text(first.disk.files.get('Busy.md')?.bytes)).toBe('two')
  })
})
