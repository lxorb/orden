import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sourceOf, type Source } from './sources'
import { linkWriting, setLinkWriting } from '../../link-format/src/api'

interface Entry {
  path: string
  name: string
  is_dir: boolean
  children: Entry[]
}
const wrote = new Set<string>()
const said = new Map<string, string>()
const opened: string[] = []
const ROOT = '/spaces/Brain'
function treeOf(paths: Iterable<string>): Entry {
  const root: Entry = { path: ROOT, name: 'Brain', is_dir: true, children: [] }
  for (const full of paths) {
    const rel = full.slice(ROOT.length + 1)
    if (rel.split('/').some((part) => part.startsWith('.'))) continue
    if (!/\.(md|pdf|canvas|base)$/i.test(rel)) continue
    let at = root
    const parts = rel.split('/')
    parts.forEach((part, i) => {
      let child = at.children.find((one) => one.name === part)
      if (!child) {
        child = {
          path: `${at.path}/${part}`,
          name: part,
          is_dir: i < parts.length - 1,
          children: [],
        }
        at.children.push(child)
      }
      at = child
    })
  }
  const sort = (entry: Entry) => {
    entry.children.sort((a, b) => (a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name)))
    entry.children.forEach(sort)
  }
  sort(root)
  return root
}
const bytes = new Map<string, Uint8Array>()
const times = new Map<string, number>()
const closed: string[] = []
const ws = {
  tree: null as Entry | null,
  activeSpaceId: 'old' as string | null,
  added: 0,
  refusing: false,
  deleted: [] as string[],
  spaces: [{ id: 'old', name: 'Old', root: '/spaces/Old' }] as { id: string; name: string; root: string }[],
  get files() {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (child.is_dir) walk(child)
        else out.push(child)
      }
    }
    if (this.tree) walk(this.tree)
    return out
  },
  get notes() {
    return this.files.filter((one) => !/\.(pdf|canvas|base)$/i.test(one.name))
  },
  undone: { record: () => undefined },
  fileCame: () => Promise.resolve(),
  addSpace: async (name: string) => {
    if (ws.refusing) return undefined
    ws.added += 1
    const space = { id: 'new', name, root: ROOT }
    ws.spaces.push(space)
    ws.activeSpaceId = space.id
    return space
  },
  deleteSpace: async (id: string) => {
    ws.deleted.push(id)
    ws.spaces = ws.spaces.filter((one) => one.id !== id)
  },
  openUnsaved: (kind: string, text: string, name: string) => ({
    id: `tab-${kind}`,
    kind,
    doc: text,
    name,
    note: { replace: () => undefined },
  }),
  close: (id: string) => void closed.push(id),
  loadTree: async () => {
    ws.tree = treeOf(wrote)
  },
  showSpace: async (id: string) => {
    ws.activeSpaceId = id
  },
  openEntry: async (path: string) => void opened.push(path),
  showPanel: () => undefined,
}
let unreadable = ''
let garbled = ''
vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    const path = String(args.path)
    if (command === 'write_note' || command === 'write_bytes') wrote.add(path)
    if (command === 'write_note') {
      said.set(path, String(args.content))
      bytes.set(path, new TextEncoder().encode(String(args.content)))
    }
    if (command === 'write_bytes') {
      if (unreadable && path.endsWith(unreadable)) return Promise.reject(new Error('disk full'))
      bytes.set(path, args.bytes as Uint8Array)
    }
    if (command === 'read_file') {
      const held = bytes.get(path)
      if (held && garbled && path.endsWith(garbled)) return Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
      return held ? Promise.resolve(held.slice().buffer) : Promise.reject(new Error('gone'))
    }
    if (command === 'set_file_times') times.set(path, Number(args.modified))
    if (command === 'file_stamp') return Promise.resolve(times.has(path) ? { modified: times.get(path) } : null)
    return Promise.resolve()
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
  isDesktop: true,
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: ws,
  firstVisiting: () => Promise.resolve({ firstVisit: { fresh: false, answered: () => undefined } }),
}))
vi.mock('../../sharing/src/api', () => ({ canWriteAt: () => true }))
vi.mock('../../link-index/src/api', () => ({
  links: { noteSaved: () => undefined, cameBack: async () => undefined },
}))
vi.mock('../../sync-store/src/api', () => ({ sync: { nudge: () => undefined } }))
vi.mock('../../web-backend/src/api', () => ({ ownKeys: async () => ({ ownKeysTaken: () => null }) }))
vi.mock('../../ui-kit/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui-kit/src/api')>()),
  viewport: { drawer: false },
}))
const carriedOver: unknown[] = []
vi.mock('./carry-over', () => ({ carryOver: async (carried: unknown) => void carriedOver.push(carried) }))
const { ImportRun, runs } = await import('./run.svelte')
const { busy } = await import('../../ui-kit/src/api')
const file = (path: string, body: string | Uint8Array = 'x'): Source =>
  sourceOf(path, typeof body === 'string' ? new TextEncoder().encode(body) : body)
async function brought(sources: Source[], name = 'Brain') {
  const run = new ImportRun({ name, label: 'my vault', where: '/Users/me/Brain', read: async () => ({ sources }) })
  runs.set(run.id, run)
  await run.start()
  return run
}
const VAULT = [file('.obsidian/app.json', '{}')]
beforeEach(() => {
  wrote.clear()
  said.clear()
  bytes.clear()
  times.clear()
  closed.length = 0
  carriedOver.length = 0
  unreadable = ''
  garbled = ''
  setLinkWriting('wikilink')
  opened.length = 0
  ws.tree = null
  ws.activeSpaceId = 'old'
  ws.added = 0
  ws.refusing = false
  ws.deleted = []
  ws.spaces = [{ id: 'old', name: 'Old', root: '/spaces/Old' }]
  busy.clear()
})
describe('an import into a new space', () => {
  test('is ready for review once every file is written and checked, and opens on its first note when completed', async () => {
    const run = await brought([
      ...VAULT,
      file('Attachments/Paper.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])),
      file('Boards/Map.canvas', '{"nodes":[],"edges":[]}'),
      file('Welcome.md', '# Welcome\n\nStart here.'),
    ])
    expect(run.phase).toBe('review')
    expect(run.tally).toEqual({ notes: 1, files: 3, skipped: 0, failed: 0 })
    expect(run.fraction).toBe(1)
    expect(opened).toEqual([])
    await run.complete()
    expect(closed).toEqual(['tab-import'])
    expect(opened).toEqual([`${ROOT}/Welcome.md`])
  })
  test('keeps its wikilinks when the Links setting was last on markdown links, and carries settings only once completed', async () => {
    setLinkWriting('shortest')
    const run = await brought([
      ...VAULT,
      file('Home.md', 'See [[Plan]] and ![[diagram.png]].\n'),
      file('Plan.md', '# Plan\n'),
      file('diagram.png', 'png'),
    ])
    expect(linkWriting()).toBe('shortest')
    expect(said.get(`${ROOT}/Home.md`)).toBe('See [[Plan]] and ![[diagram.png]].\n')
    expect(carriedOver).toEqual([])
    await run.complete()
    expect(carriedOver).toHaveLength(1)
  })
  test('holding nothing but Obsidian housekeeping makes no empty space and says why', async () => {
    const run = await brought([...VAULT, file('.obsidian/workspace.json', '{}'), file('.trash/Old.md', 'gone')])
    expect(run.phase).toBe('failed')
    expect(ws.added).toBe(0)
    expect(busy.trouble).toBe('Nothing in there can be read as notes.')
  })
  test('lists what it left behind, such as files in iCloud rather than on this Mac', async () => {
    const run = await brought([
      ...VAULT,
      file('.Plan.md.icloud', 'bplist00'),
      file('.Budget.md.icloud', 'bplist00'),
      file('Attachments/.diagram.png.icloud', 'bplist00'),
      file('Home.md', '# Home\n\nSee [[Plan]] and [[Budget]].\n'),
    ])
    expect(wrote).toContain(`${ROOT}/Home.md`)
    expect(run.rows.filter((row) => row.kind === 'skipped')).toEqual([
      { kind: 'skipped', path: '', why: '3 files are in iCloud rather than on this Mac' },
    ])
  })
  test('with every note in iCloud says so, rather than only that nothing could be read', async () => {
    await brought([...VAULT, file('.Plan.md.icloud', 'bplist00'), file('.Budget.md.icloud', 'bplist00')])
    expect(busy.trouble).toBe('Nothing in there can be read as notes. 2 files are in iCloud rather than on this Mac')
  })
  test('says it was not written when its space cannot be made', async () => {
    ws.refusing = true
    const run = await brought([...VAULT, file('Home.md', '# Home')])
    expect(run.phase).toBe('failed')
    expect(busy.trouble).toBe('That import could not be written.')
    expect(wrote.size).toBe(0)
  })
  test('a file that cannot be read fails alone and the rest still come over', async () => {
    const broken: Source = {
      path: 'Atlas/Scan.tiff',
      text: () => Promise.reject(new Error('x')),
      bytes: () => Promise.reject(new Error('Atlas/Scan.tiff could not be read.')),
    }
    const run = await brought([...VAULT, broken, file('Home.md', '# Home\n')])
    expect(run.phase).toBe('review')
    expect(run.rows.filter((row) => row.kind === 'failed')).toEqual([
      { kind: 'failed', path: 'Atlas/Scan.tiff', why: 'Could not be read.' },
    ])
    expect(run.tally.notes).toBe(1)
  })
  test('a file that cannot be written fails alone and the rest still come over', async () => {
    unreadable = 'diagram.png'
    const run = await brought([...VAULT, file('diagram.png', 'png'), file('Home.md', '# Home\n')])
    expect(run.rows.find((row) => row.kind === 'failed')).toEqual({
      kind: 'failed',
      path: 'diagram.png',
      why: 'Disk full',
    })
    expect(run.tally).toMatchObject({ notes: 1, files: 1, failed: 1 })
  })
  test('a file whose written bytes differ from the source fails the check', async () => {
    garbled = 'diagram.png'
    const run = await brought([...VAULT, file('diagram.png', 'png'), file('Home.md', '# Home\n')])
    expect(run.rows.find((row) => row.kind === 'failed')).toEqual({
      kind: 'failed',
      path: 'diagram.png',
      why: 'What was written differs from the source.',
    })
    expect(run.tally).toMatchObject({ notes: 1, files: 1, failed: 1 })
  })
  test('cancelled, takes its space away again and goes back to the space it came from', async () => {
    const run = await brought([...VAULT, file('Home.md', '# Home\n')])
    await run.cancel()
    expect(ws.deleted).toEqual(['new'])
    expect(ws.activeSpaceId).toBe('old')
    expect(runs.has(run.id)).toBe(false)
  })
  test('cancelled while it reads, stops reading and leaves no space behind', async () => {
    let release = (): void => undefined
    const held = new Promise<void>((done) => (release = done))
    const slow: Source = {
      path: 'Slow.md',
      text: () => held.then(() => '# Slow\n'),
      bytes: () => held.then(() => new Uint8Array()),
    }
    const run = new ImportRun({
      name: 'Brain',
      label: 'my vault',
      read: async () => ({ sources: [...VAULT, slow, file('Next.md', '# Next\n')] }),
    })
    runs.set(run.id, run)
    const running = run.start()
    await vi.waitFor(() => expect(run.space).not.toBeNull())
    const cancelling = run.cancel()
    release()
    await Promise.all([running, cancelling])
    expect(ws.deleted).toEqual(['new'])
    expect(wrote).not.toContain(`${ROOT}/Next.md`)
  })
  test('writes a prompt with every count and every file that failed or was skipped', async () => {
    unreadable = 'diagram.png'
    const run = await brought([
      ...VAULT,
      file('.Plan.md.icloud', 'bplist00'),
      file('diagram.png', 'png'),
      file('Home.md', '# Home\n'),
    ])
    expect(run.prompt).toBe(
      [
        'I am importing my vault (/Users/me/Brain) into Orden, as the new space “Brain”.',
        '1 note and 1 other file were imported. 1 file was skipped and 1 failed.',
        '',
        'These files failed:',
        '- diagram.png: Disk full',
        '',
        'These files were skipped:',
        '- 1 file is in iCloud rather than on this Mac',
        '',
        'Fix these files in the source so Orden can import them, or tell me why they can’t be imported.',
      ].join('\n'),
    )
  })
})
