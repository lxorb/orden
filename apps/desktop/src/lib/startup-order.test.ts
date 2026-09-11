import { describe, expect, test, vi } from 'vitest'

/** The launch, in order. One rule, and this is where it is held: the file list is
 *  on screen before anything reads a note.
 *
 *  A harness rather than a unit test, because the thing under test is an order
 *  across four stores. Every command the launch sends is recorded with what was
 *  true when it was sent - whether the tree was up, and how many frames the browser
 *  had painted - so the assertions can be about the sequence rather than about any
 *  one call. See startup.svelte.ts, and `restore` in workspace.svelte.ts. */

/** How many frames the stubbed browser has painted. `startup.shown` asks for two
 *  per paint, so anything sent at nought was sent before the first one. */
let frames = 0

vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
  setTimeout(() => {
    frames += 1
    run()
  }, 0)
  return 0
})

vi.stubGlobal('requestIdleCallback', (run: () => void) => {
  setTimeout(run, 0)
  return 0
})

/** A space with enough notes in it that reading them all would be noticed. */
const NOTES = Array.from({ length: 40 }, (_, at) => `note-${String(at).padStart(2, '0')}.md`)

interface Sent {
  command: string
  /** Whether the file list had something to draw when this was sent. */
  listed: boolean
  /** Frames painted by then. */
  frames: number
}

const sent: Sent[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  // The desktop path, so the launch does not reach for the browser's storage,
  // which node has none of.
  isNative: true,
  isDesktop: false,
  invoke: async (command: string) => {
    // Read before answering: what matters is what was true at the moment the app
    // asked, not by the time it had its answer.
    const { workspace } = await import('./workspace.svelte')
    sent.push({ command, listed: !!workspace.tree, frames })

    switch (command) {
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: NOTES.map((name) => ({
            name,
            path: `/space/${name}`,
            is_dir: false,
            modified: 0,
            created: 0,
            children: [],
          })),
        }
      case 'read_note':
        return '# a note\n'
      case 'scan_links':
        return { notes: [], files: [] }
      default:
        return undefined
    }
  },
}))

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')

/** Waits out the idle queue behind the first paint. */
async function settle() {
  for (let round = 0; round < 12; round++) await new Promise((done) => setTimeout(done, 0))
}

/** One launch, and everything it sent. Run once: a store is a singleton and a
 *  second launch would be restoring over the first. */
const launch = await (async () => {
  await workspace.restore()
  await settle()
  return sent
})()

const at = (command: string) => launch.findIndex((one) => one.command === command)

describe('the launch', () => {
  test('lists the spaces and the files, and nothing else, before the first frame', () => {
    const before = launch.filter((one) => one.frames === 0).map((one) => one.command)

    expect(before).toEqual(['list_spaces', 'read_tree'])
  })

  test('paints the file list before it reads a single body', () => {
    expect(at('read_tree')).toBeGreaterThanOrEqual(0)
    expect(at('read_note')).toBeGreaterThan(at('read_tree'))

    const first = launch[at('read_note')]
    expect(first?.listed).toBe(true)
    // Two callbacks for the paint that put the tree on screen.
    expect(first?.frames).toBe(2)
  })

  test('scans the space for its links after the list is up, not with it', () => {
    const scan = launch[at('scan_links')]

    expect(scan?.listed).toBe(true)
    expect(scan?.frames).toBeGreaterThanOrEqual(2)
    // And after the open note, which is the one read anybody is waiting on.
    expect(at('scan_links')).toBeGreaterThan(at('read_note'))
  })

  test('reads one note, not the space, to open what it was left on', () => {
    expect(launch.filter((one) => one.command === 'read_note')).toHaveLength(1)
  })

  test('ends with the index built and the tree it was built for', () => {
    expect(links.rootOf()).toBe('/space')
    expect(startup.reached('rooms')).toBe(true)
    expect(workspace.tree?.children).toHaveLength(NOTES.length)
  })
})
