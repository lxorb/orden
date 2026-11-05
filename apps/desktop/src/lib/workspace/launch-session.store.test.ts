import { describe, expect, test, vi } from 'vitest'

/** A launch brings a session back a piece at a time on a disk that may be slow, and a window
 *  can go at any of those moments: a close, a kill, and whatever writes the session on its own.
 *  Nothing the session read may be lost by a write before that piece is back, so this stops
 *  a launch at each round trip it makes, writes the session there as a close does, kills it,
 *  and launches again. A fresh copy of the store each time, on the one disk and storage. */

const held = vi.hoisted(() => ({
  disk: null as import('../../../test/disk').Disk | null,
  /** The round trip that does not answer, counted from the launch. */
  stopAt: -1,
  /** Or the first of a command that does not. */
  stopOn: null as string | null,
  count: 0,
  reached: false,
  gate: null as Promise<void> | null,
  asked: [] as string[],
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    held.asked.push(command)
    const stops = held.count++ === held.stopAt || held.stopOn === command
    if (stops) {
      held.stopOn = null
      held.reached = true
      await held.gate
    }
    if (command === 'list_spaces') {
      return [
        { name: 'One', path: '/spaces/One' },
        { name: 'Two', path: '/spaces/Two' },
      ]
    }
    return held.disk!.invoke(command, args)
  },
}))
// The launch's own turn for the sets is `allIn` here: a turn coming late to a window this has
// killed would fetch them into the next window's copy of the store.
vi.mock('../startup.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../startup.svelte')>()
  const turn = real.startup.turn.bind(real.startup)
  real.startup.turn = (stage) => (stage === 'doors' ? new Promise(() => undefined) : turn(stage))
  return real
})
// The switcher's speaker, fetched once the sets wake: loaded after a test's window is gone,
// it would make a set store of its own in the next one's modules (workspace.svelte reaches
// surfaces.svelte since #331).
vi.mock('../SpaceSound.svelte', () => ({ default: () => undefined }))
const { Disk, memoryStorage } = await import('../../../test/disk')
const d = new Disk()
held.disk = d
vi.stubGlobal('localStorage', memoryStorage())
// A window killed lets go of its slot with its lock, and here nothing lets go: no locks, so
// every launch is the first window.
vi.stubGlobal('navigator', {})
vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))

const ONE = '/spaces/One'
const TWO = '/spaces/Two'
const DRAFT = 'ONLY-IN-THE-SESSION\n'
const TYPED = 'TYPED-ON-THE-NOTE'
const IN_A_SET = 'WORDS-IN-A-SET-OUT-OF-SIGHT\n'
const CLOSED = 'CLOSED-WORDS'

const draft = (fields: object) => ({
  kind: 'note',
  name: 'a.md',
  doc: '',
  dirty: false,
  cursor: 0,
  scroll: 0,
  ...fields,
})
const one = (id: string, tabs: object[]) => ({
  frame: { kind: 'pane', pane: { id, active: 0, linked: false, tabs } },
  focused: id,
  panel: null,
})

const SESSION = {
  version: 2,
  spaces: [
    { id: 'one', name: 'One', root: ONE },
    { id: 'two', name: 'Two', root: TWO },
  ],
  activeSpace: 'one',
  panel: null,
  layout: one('p1', [
    draft({ path: `${ONE}/slow.md`, name: 'slow.md' }),
    draft({ path: null, name: 'Untitled', doc: DRAFT, dirty: true }),
    draft({
      path: `${ONE}/b.md`,
      name: 'b.md',
      doc: `base\n${TYPED}\n`,
      base: 'base\n',
      dirty: true,
    }),
  ]),
  closed: [
    {
      paneId: 'p1',
      at: 0,
      draft: draft({
        path: `${ONE}/closed.md`,
        name: 'closed.md',
        doc: `base\n${CLOSED}\n`,
        base: 'base\n',
        dirty: true,
      }),
    },
  ],
  sets: {
    on: 'one',
    aside: {
      two: {
        right: null,
        layout: one('p2', [
          draft({ path: `${TWO}/c.md`, name: 'c.md' }),
          draft({ path: null, name: 'Untitled', doc: IN_A_SET, dirty: true }),
        ]),
      },
    },
  },
}

function freshDisk() {
  d.reset()
  d.folders.add(ONE)
  d.folders.add(TWO)
  d.files.set(`${ONE}/slow.md`, 'slow\n')
  d.files.set(`${ONE}/b.md`, 'base\n')
  d.files.set(`${ONE}/closed.md`, 'base\n')
  d.files.set(`${TWO}/c.md`, 'c\n')
}

function freshRound(session: object = SESSION) {
  freshDisk()
  localStorage.clear()
  localStorage.setItem('nib:workspace', JSON.stringify(session))
}

/** A new window's store, nothing shared with the last but the disk and the storage. */
async function newWindow() {
  vi.resetModules()
  const { workspace } = await import('../workspace.svelte')
  return workspace
}

type Workspace = Awaited<ReturnType<typeof newWindow>>

const session = () => localStorage.getItem('nib:workspace') ?? ''

/** Whether words are written down somewhere a next launch finds them. */
function kept(words: string, path?: string) {
  return session().includes(words.trim()) || (path ? d.files.get(path)?.includes(words) : false)
}

/** Every set the store has built, once its launch has got to them. */
async function allIn(workspace: Workspace) {
  const { sets } = await import('./sets.svelte')
  await sets.wake()
  await workspace.writesSettled()
  return workspace.tabs.map((tab) => tab.note.latest)
}

/** A launch that goes all the way: the words all back, in a tab or in their file. */
async function goodLaunch() {
  held.stopAt = -1
  const workspace = await newWindow()
  await workspace.restore()
  const words = await allIn(workspace)
  expect(words).toContain(DRAFT)
  expect(words).toContain(IN_A_SET)
  expect(words.some((one) => one.includes(TYPED))).toBe(true)
  expect(d.files.get(`${ONE}/b.md`)).toContain(TYPED)
  expect(workspace.closed.stack.some((one) => one.draft.doc.includes(CLOSED))).toBe(true)
  return workspace
}

/** How many round trips a launch with sets makes, all the way. */
async function roundTrips() {
  freshRound()
  held.stopAt = -1
  held.count = 0
  held.asked = []
  const workspace = await newWindow()
  await workspace.restore()
  await allIn(workspace)
  return held.count
}

describe('a persist while the session is coming back', () => {
  test('keeps everything, at every round trip of a launch, and a good launch after it brings it back', async () => {
    const trips = await roundTrips()
    expect(trips).toBeGreaterThan(5)

    // The window closes, or something writes the session, while one read has not answered.
    for (let at = 0; at < trips; at += 1) {
      freshRound()
      // Never answers: a window killed does not come back to write over the next one.
      held.gate = new Promise(() => undefined)
      held.reached = false
      held.count = 0
      held.stopAt = at
      const workspace = await newWindow()
      void workspace.restore().then(() => allIn(workspace))
      await vi.waitFor(() => expect(held.reached).toBe(true), { timeout: 5000 })
      workspace.persist()

      const lost = [
        kept(DRAFT) ? null : 'draft',
        kept(TYPED, `${ONE}/b.md`) ? null : 'typed',
        kept(IN_A_SET) ? null : 'set',
        kept(CLOSED) ? null : 'closed',
      ].filter(Boolean)
      expect(lost, `round trip ${at}, ${held.asked[at]}`).toEqual([])

      // Killed there: what it was waiting for never answers it, and the next launch is good.
      await goodLaunch()
    }
  }, 240_000)

  test('a launch that fails keeps what it read for the next', async () => {
    freshRound()
    held.stopAt = -1
    const workspace = await newWindow()
    vi.spyOn(workspace, 'applyLayout').mockRejectedValue(new Error('the disk went'))
    await expect(workspace.restore()).rejects.toThrow('the disk went')
    workspace.persist()
    expect(session()).toContain(DRAFT.trim())
    await goodLaunch()
  })

  test('a tab opened meanwhile is written with what is coming, and lands once', async () => {
    freshRound()
    d.files.set(`${ONE}/gap.md`, 'gap\n')
    let open: () => void = () => undefined
    held.gate = new Promise((go) => (open = go))
    held.reached = false
    held.stopAt = -1
    // The first read of a note waits, so the list is up and the tabs are not.
    held.stopOn = 'read_note'
    const workspace = await newWindow()
    const restoring = workspace.restore()
    await vi.waitFor(() => expect(workspace.tree).toBeTruthy(), { timeout: 5000 })
    await workspace.open(`${ONE}/gap.md`)
    workspace.persist()
    const written = session()
    expect(written).toContain(DRAFT.trim())
    expect(written).toContain('gap.md')
    expect(written).toContain('slow.md')

    open()
    await restoring
    const paths = workspace.tabs.map((tab) => tab.path)
    expect(paths.filter((one) => one === `${ONE}/gap.md`)).toHaveLength(1)
    expect(workspace.tabs.map((tab) => tab.note.latest)).toContain(DRAFT)
  })

  test.each([
    [
      'a flat strip',
      {
        tabs: [
          draft({ path: `${ONE}/slow.md`, name: 'slow.md' }),
          draft({ path: null, name: 'Untitled', doc: DRAFT, dirty: true }),
        ],
        active: 0,
      },
      DRAFT.trim(),
    ],
    ['a list of paths', { openPaths: [`${ONE}/slow.md`], activePath: `${ONE}/slow.md` }, 'slow.md'],
  ])('holds for a session written as %s', async (_, shape, words) => {
    freshRound({ spaces: SESSION.spaces, activeSpace: 'one', panel: null, ...shape })
    let open: () => void = () => undefined
    held.gate = new Promise((go) => (open = go))
    held.reached = false
    held.count = 0
    held.stopAt = 0
    const workspace = await newWindow()
    const restoring = workspace.restore()
    await vi.waitFor(() => expect(held.reached).toBe(true), { timeout: 5000 })
    workspace.persist()
    expect(session()).toContain(words)

    open()
    held.stopAt = -1
    await restoring
    expect(workspace.tabs.map((tab) => tab.path)).toContain(`${ONE}/slow.md`)
    // And from here on the session says what is open.
    workspace.persist()
    expect(session()).toContain('"layout"')
  })

  test('a set whose build fails stays as it was read, and builds on the next asking', async () => {
    freshRound()
    held.stopAt = -1
    const workspace = await newWindow()
    await workspace.restore()
    const { sets } = await import('./sets.svelte')
    const spy = vi.spyOn(workspace, 'built').mockRejectedValueOnce(new Error('the disk went'))
    await sets.wake()
    spy.mockRestore()
    workspace.persist()
    expect(session()).toContain(IN_A_SET.trim())

    await sets.wake()
    expect(workspace.tabs.map((tab) => tab.note.latest)).toContain(IN_A_SET)
  })
})
