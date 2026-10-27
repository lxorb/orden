import { beforeEach, describe, expect, test, vi } from 'vitest'
import { shownName } from './note-name'
import { scanNote } from './scan-note'
import type { Hit } from './search/match'
import type { Query } from './search/query'

/** The index reads a space through the platform shim. Under node there is none,
 *  so a folder of notes stands in for one - which is why the store is imported
 *  further down rather than at the top. */

const ROOT = '/space'

let notes: Record<string, string> = {}
let files: string[] = []
/** Every note that was written, so a rewrite can be read back. */
let written: string[] = []
/** How many notes have been read off the "disk" since the space was built. The
 *  index exists so that a surface drawn from the whole space does not read it again;
 *  a count says whether one did, where a clock says what the machine was doing. */
let reads = 0
/** Something that happens the moment a note is written: a save landing while a
 *  rewrite is still going through the space. */
let afterWrite: ((relative: string) => void) | null = null
/** Every note a snapshot was taken of, so "one snapshot per touched note" is a
 *  thing the test can see rather than a thing the comment claims. */
let snapshots: string[] = []
/** Notes the "disk" will not write: read-only, or held by another program. */
const unwritable = new Set<string>()
/** Scans held open, by the space each is of: the rows it will answer with, and the
 *  hand that lets it answer. Empty unless a test is standing in the gap between a
 *  space being asked for and its rows arriving - which is where the app lives for
 *  the first second of every space, and where everything in `a space still being
 *  read` goes wrong.
 *
 *  A queue per space, because a space closed and opened again is two scans of one
 *  root and the whole point of one of these tests. See `opening`. */
const holding = new Map<string, { rows: unknown; gate: Promise<void>; taken: () => void }[]>()

const stringOf = (args: Record<string, unknown> | undefined, name: string) => {
  const value = args?.[name]
  return typeof value === 'string' ? value : ''
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = stringOf(args, 'path')

    switch (command) {
      case 'scan_links': {
        // A scan reads the space as it was when it was asked. A held one says so
        // out loud: its rows were taken before the test touched anything and are
        // handed over whenever the test lets go, so everything the index is told
        // meanwhile is news the scan cannot have.
        const scan = holding.get(stringOf(args, 'root'))?.shift()
        if (!scan) {
          // Any folder in the space can be read on its own, the way the desktop's
          // `scan_links` reads one: the rows are relative to that folder.
          const root = stringOf(args, 'root')
          const folder = root.startsWith(`${ROOT}/`) ? `${root.slice(ROOT.length + 1)}/` : ''
          const inside = (one: string) => one.startsWith(folder)
          const own = (one: string) => one.slice(folder.length)

          return {
            notes: Object.entries(notes)
              .filter(([one]) => inside(one))
              .map(([one, content]) => scanNote(own(one), content)),
            files: files.filter(inside).map(own),
          }
        }

        scan.taken()
        await scan.gate
        return scan.rows
      }
      case 'read_note': {
        const relative = path.slice(ROOT.length + 1)
        const doc = notes[relative]
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        reads += 1
        return doc
      }
      case 'write_note': {
        const relative = path.slice(ROOT.length + 1)
        if (unwritable.has(relative)) throw new Error(`permission denied: ${path}`)
        notes[relative] = stringOf(args, 'content')
        written.push(relative)
        afterWrite?.(relative)
        return undefined
      }
      case 'snapshot_note':
        snapshots.push(path.slice(ROOT.length + 1))
        return undefined
      default:
        return undefined
    }
  },
}))

/** The spaces shared with this account to be read, by root. What may be written
 *  where is sharing.svelte.ts's, which wants an account a unit test has none of. */
const readOnly = new Set<string>()
/** The notes somebody else may have written, by path: shared on their own, say. */
const theirs = new Set<string>()
vi.mock('./sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sharing.svelte')>()),
  canWriteAt: (path: string) => ![...readOnly].some((root) => path.startsWith(`${root}/`)),
  trustsHtmlAt: (path: string | null) => path === null || !theirs.has(path),
}))

/** The space search, stood in for. The index asks it for the mentions of a note,
 *  and the real one is either behind the Rust crate or inside a worker; neither is
 *  here. What matters is the shape of the question and the answer, so the matcher
 *  the app actually uses runs over the notes this file holds. */
vi.mock('./search/space', () => ({
  searchSpace: async (
    _root: string,
    query: Query,
    _terms: string[],
    limit: number,
    onFound: (found: { hits: Hit[]; loose: Hit[] }) => void,
    excluded: readonly string[] = [],
  ) => {
    const { Matcher } = await import('./search/match')
    const matcher = new Matcher(query)
    const hits: Hit[] = []

    for (const [one, content] of Object.entries(notes)) {
      if (excluded.some((left) => one === left || one.startsWith(`${left}/`))) continue

      hits.push(
        ...matcher.hits(
          {
            path: `${ROOT}/${one}`,
            relative: one,
            name: one.split('/').pop() ?? one,
            body: content,
          },
          limit,
        ),
      )
    }

    onFound({ hits, loose: [] })
  },
}))

const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')

// A space is scanned once its file list is on screen, which is what the launch
// says for itself; here it is said once so a scan is not waiting on a frame that
// never comes. See startup.svelte.ts.
void startup.shown()

async function space(contents: Record<string, string>, others: string[] = []) {
  notes = { ...contents }
  files = [...others]
  written = []
  snapshots = []
  reads = 0
  await links.build(ROOT)
}

/** A space whose scan is still in the air, and the hand that lands it.
 *
 *  What the first second of any space looks like from the inside: the walk has
 *  been done and its rows have not arrived, and the app is saving, deleting and
 *  moving notes meanwhile. Awaited until the scan has actually been asked for, so
 *  everything a test does next is news the rows cannot hold; `land` hands them
 *  over and waits for them to be taken.
 *
 *  Held by space, so a test can have two of them open at once - which is how a
 *  space opened and left while its rows were still coming is written down. */
async function opening(
  contents: Record<string, string>,
  root = ROOT,
  others: string[] = [],
): Promise<{ land: () => Promise<void> }> {
  if (root === ROOT) {
    notes = { ...contents }
    files = [...others]
    written = []
    snapshots = []
    reads = 0
  }

  let go: () => void = () => undefined
  let taken: () => void = () => undefined
  const gate = new Promise<void>((done) => (go = done))
  const asked = new Promise<void>((done) => (taken = done))
  const queue = holding.get(root) ?? []
  queue.push({
    rows: {
      notes: Object.entries(contents).map(([one, content]) => scanNote(one, content)),
      files: [...others],
    },
    gate,
    taken,
  })
  holding.set(root, queue)

  const scanned = links.build(root)
  await asked

  return {
    land: async () => {
      go()
      await scanned
    },
  }
}

const at = (relative: string) => `${ROOT}/${relative}`

beforeEach(() => {
  links.clear()
  holding.clear()
})

describe('backlinks', () => {
  test('find every note that points here, whichever way it was written', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] for more',
      'Two.md': 'see [the plan](Plan.md)',
      'Three.md': 'nothing to do with it',
    })

    // The file's own name. What a row shows is `shownName` of it, read once by
    // whatever draws the row; see note-name.ts and HitList.svelte.
    expect(links.backlinks(at('Plan.md')).map((one) => one.name)).toEqual(['One.md', 'Two.md'])
  })

  /** The panel used to take an ending off a name an ending had already come off of,
   *  so a note called `a.canvas.md` read `a` here and `a.canvas` in the file list,
   *  the palette and the tab strip. */
  test('name a note the one way every other list names it', async () => {
    await space({
      'Plan.md': '# Plan',
      'a.canvas.md': 'see [[Plan]]',
      'NOTE.MD': 'see [[Plan]]',
    })

    const shown = links.backlinks(at('Plan.md')).map((one) => shownName(one.name))
    expect(shown).toEqual(['a.canvas', 'NOTE'])
  })

  test('carry the line and the words around it', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'first\nsee [[Plan]] here' })

    expect(links.backlinks(at('Plan.md'))[0]).toMatchObject({
      path: 'One.md',
      line: 1,
      text: 'see [[Plan]] here',
    })
  })

  test('do not count a link that resolves to a different note of the same name', async () => {
    await space({
      'Plan.md': 'the one at the top',
      'ideas/Plan.md': 'the one in the folder',
      'ideas/One.md': 'see [[Plan]]',
    })

    // Written beside the folder's own Plan, so that is the one it means.
    expect(links.backlinks(at('ideas/Plan.md')).map((one) => one.path)).toEqual(['ideas/One.md'])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a path-qualified link reaches past the nearer note', async () => {
    await space({
      'Plan.md': 'the one at the top',
      'ideas/Plan.md': 'the one in the folder',
      // The extension alone does not say which; the folder does.
      'ideas/One.md': 'see [[ideas/Plan]] and not [[Plan.md]]',
    })

    expect(links.backlinks(at('ideas/Plan.md')).map((one) => one.path)).toEqual([
      'ideas/One.md',
      'ideas/One.md',
    ])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a note does not link to itself in this list', async () => {
    await space({ 'Plan.md': 'see [[Plan]]' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a link in code is not a link', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'write `[[Plan]]` to link' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })
})

describe('links out', () => {
  test('say where each one goes, and which go nowhere', async () => {
    await space({
      'One.md': 'see [[Plan]] and [[Nowhere]] and [[ideas/Spark]]',
      'Plan.md': '# Plan',
      'ideas/Spark.md': '# Spark',
    })

    expect(links.outgoing(at('One.md'))).toEqual([
      expect.objectContaining({ target: 'Plan', to: 'Plan.md', name: 'Plan.md' }),
      expect.objectContaining({ target: 'Nowhere', to: null, name: 'Nowhere' }),
      expect.objectContaining({ target: 'ideas/Spark', to: 'ideas/Spark.md', name: 'Spark.md' }),
    ])
  })

  test('a link into the note itself is not a link out', async () => {
    await space({ 'One.md': '# Today\n\nsee [[#Today]]' })
    expect(links.outgoing(at('One.md'))).toEqual([])
  })

  /** What `touch "$(printf 'U\xcc\x88bersicht.md')"` leaves on a Mac: the name as the
   *  disk keeps it, a `U` and a combining mark, while the link is typed with one `Ü`. */
  test('reach a note whose name the disk keeps decomposed, and back', async () => {
    const decomposed = 'Übersicht.md'
    await space({ [decomposed]: '# Overview', 'One.md': 'see [[Übersicht]]' })

    expect(links.outgoing(at('One.md'))).toEqual([
      expect.objectContaining({ target: 'Übersicht', to: decomposed }),
    ])
    expect(links.backlinks(at(decomposed)).map((one) => one.name)).toEqual(['One.md'])
  })
})

describe('mentions', () => {
  test('are the name written without a link to it', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'the Plan is coming along',
      'Two.md': 'see [[Plan]]',
    })

    const found = await links.unlinked(at('Plan.md'), ROOT)
    expect(found.map((one) => one.path)).toEqual(['One.md'])
  })

  test('the name has to stand as a word of its own', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'Planning is not the Plan' })

    const found = await links.unlinked(at('Plan.md'), ROOT)
    expect(found).toHaveLength(1)
  })

  test('a name too short to search for finds nothing', async () => {
    await space({ 'A.md': '# A', 'One.md': 'A is a letter' })
    expect(await links.unlinked(at('A.md'), ROOT)).toEqual([])
  })
})

describe('a note saved keeps the index up to date', () => {
  test('a link written now is a backlink now', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'nothing yet' })
    expect(links.backlinks(at('Plan.md'))).toEqual([])

    links.noteSaved(at('One.md'), 'now [[Plan]] is linked')
    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['One.md'])
  })

  test('a note that has gone takes its links with it', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })
    links.noteGone(at('One.md'))
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('a note that moved answers to its new path', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })
    links.notesMoved(at('One.md'), at('deep/One.md'))
    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['deep/One.md'])
  })

  test('the version moves only when something changed', async () => {
    await space({ 'Plan.md': '# Plan' })
    const was = links.version

    links.noteSaved(at('Plan.md'), '# Plan changed')
    expect(links.version).toBeGreaterThan(was)
  })

  test('the index handed to the editor is the same object until it changes', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '# One' })

    // Compared by identity on the other side, so that a keystroke somewhere in
    // the app does not redraw every link on screen.
    const first = links.index(at('Plan.md'))
    expect(links.index(at('Plan.md'))).toBe(first)

    links.noteSaved(at('One.md'), '# One changed')
    expect(links.index(at('Plan.md'))).not.toBe(first)

    // And a different note being open is a different index, since which note is
    // open decides what `[[#Heading]]` and an ambiguous name mean.
    expect(links.index(at('One.md'))).not.toBe(links.index(at('Plan.md')))
  })

  test('a note read for an embed comes back, and comes back fresh after a save', async () => {
    await space({ 'Plan.md': '# Plan' })

    expect(await links.index(null).read('Plan.md')).toBe('# Plan')
    links.noteSaved(at('Plan.md'), '# Changed')
    expect(await links.index(null).read('Plan.md')).toBe('# Changed')
  })

  /** A website is a file the app writes as the reading moves: the keeper brings the
   *  `.url` up to date and the site's own mark arrives in it, which is what the row
   *  in the file list draws instead of the plain globe. Written while the app is
   *  running, so nothing rescans the space - and a row that waits for the next launch
   *  to wear the favicon is a row that says the wrong thing all afternoon. See
   *  web-tab/keep.ts. */
  test('a website written while the app runs hands the row the site’s own mark', async () => {
    await space({ 'Plan.md': '# Plan' })
    const site = at('A site.url')
    expect(links.faviconOf(site)).toBeNull()

    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/read\nTitle=A site\n' +
        'Nib-Icon=https://a.example/icon.png\n',
    )

    expect(links.faviconOf(site)).toBe('https://a.example/icon.png')
    // And where it points, which is what this device's own sight of the site is
    // looked up by; see `favicons` in web-tab/pages.svelte.ts.
    expect(links.shortcutOf(site)).toBe('https://a.example/read')
  })

  test('and the same file written again with a new mark answers with the new one', async () => {
    await space({ 'Plan.md': '# Plan' })
    const site = at('A site.url')

    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/\nNib-Icon=https://a/one.png\n',
    )
    links.noteSaved(
      site,
      '[InternetShortcut]\nURL=https://a.example/\nNib-Icon=https://a/two.png\n',
    )

    expect(links.faviconOf(site)).toBe('https://a/two.png')
  })
})

/** The first second of a space, which is the one the app spends every launch in:
 *  the rows have been read off the disk and have not arrived yet, and notes are
 *  being written, deleted and moved the whole time.
 *
 *  What the rows say about the space is older than what the index has been told
 *  since, and taking them as the answer threw the news away - silently, and for
 *  good, because nothing reads a space twice while it is open. That is a `[[` list
 *  that holds a different subset of the space on every launch. */
describe('a space still being read', () => {
  test('keeps a note written while the rows were in the air', async () => {
    const scan = await opening({ 'Plan.md': '# Plan' })

    // Written after the walk went past, which is where a new note lands for the
    // whole of a launch: a note made out of a canvas card, one the account has
    // just brought down, one somebody typed.
    links.noteSaved(at('One.md'), 'see [[Plan]]')
    await scan.land()

    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['One.md'])
  })

  test('takes the words of the save over the words the walk read', async () => {
    const scan = await opening({ 'Plan.md': '# Plan', 'One.md': 'nothing yet' })

    links.noteSaved(at('One.md'), 'now [[Plan]] is linked')
    await scan.land()

    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['One.md'])
  })

  test('does not bring back a note deleted while the rows were in the air', async () => {
    const scan = await opening({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })

    links.noteGone(at('One.md'))
    await scan.land()

    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('leaves a note moved while the rows were in the air where it moved to', async () => {
    const scan = await opening({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]]' })

    links.notesMoved(at('One.md'), at('deep/One.md'))
    await scan.land()

    expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toEqual(['deep/One.md'])
  })

  /** A file is news the rows cannot hold as much as a note is: one deleted or
   *  renamed while they were in the air came back with them under the name it no
   *  longer has, and a link to it went on resolving. */
  test('does not bring back a file deleted or moved while the rows were in the air', async () => {
    const scan = await opening({ 'One.md': 'see [[report.pdf]]' }, ROOT, [
      'Docs.url',
      'Papers/report.pdf',
    ])

    links.noteGone(at('Docs.url'))
    links.notesMoved(at('Papers'), at('Archive'))
    await scan.land()

    expect(links.index(null).files).toEqual(['Archive/report.pdf'])
  })

  test('keeps a file put beside the notes while the rows were in the air', async () => {
    const scan = await opening({ 'Plan.md': '# Plan' })

    links.fileAdded('talk.webm')
    await scan.land()

    expect(links.index(null).files).toContain('talk.webm')
  })

  /** A `[[` list that offers a note from the space somebody has just left is worse
   *  than one that is late: the index says which space it is of the moment it is
   *  asked to read one, so until the rows land it holds nothing rather than the
   *  last space's notes under this space's name. */
  test('holds nothing of the space before it', async () => {
    await space({ 'Theirs.md': '# Theirs', 'One.md': 'see [[Theirs]]' })
    expect(links.index(null).notes).toHaveLength(2)

    const scan = await opening({ 'Mine.md': '# Mine' }, '/other')
    expect(links.index(null).notes).toEqual([])
    expect(links.scanning).toBe(true)

    await scan.land()
    expect(links.index(null).notes.map((one) => one.path)).toEqual(['Mine.md'])
  })

  /** Two spaces opened one after the other, the first's rows landing last. */
  test('drops the rows of a space that is no longer open', async () => {
    const first = await opening({ 'Theirs.md': '# Theirs' }, '/one')
    const second = await opening({ 'Mine.md': '# Mine' }, '/two')

    await first.land()
    await second.land()

    expect(links.rootOf()).toBe('/two')
    expect(links.index(null).notes.map((one) => one.path)).toEqual(['Mine.md'])
  })

  /** And the same space closed and opened again, which a root cannot tell apart
   *  from one space read once: both scans are of `/one`, and the older one's rows
   *  are still older. A scan carries its own number for exactly this; see
   *  `build`. */
  test('drops the rows of a scan the space has already been read again since', async () => {
    const first = await opening({ 'Old.md': '# Old' }, '/one')
    links.clear()
    const second = await opening({ 'New.md': '# New' }, '/one')
    links.noteSaved('/one/Fresh.md', '# Fresh')

    await first.land()
    await second.land()

    expect(links.index(null).notes.map((one) => one.path)).toEqual(['New.md', 'Fresh.md'])
  })

  /** A plane is read through a module that is fetched, so a space can open between
   *  the asking and the reading. Fetched here first, so that what the app's own
   *  `import` waits for is a microtask rather than a disk this test cannot time. */
  test('does not take a plane read in the space before it', async () => {
    await import('./scan-canvas')
    await space({ 'Plan.md': '# Plan' })
    links.canvasRead(at('Board.canvas'), JSON.stringify({ nodes: [], edges: [] }))

    const scan = await opening({ 'Mine.md': '# Mine' }, '/other')
    await scan.land()

    expect(links.index(null).notes.map((one) => one.path)).toEqual(['Mine.md'])
  })

  /** Every card on a plane is drawn from the index, so a new list of notes is every
   *  card drawn again: a stroke saved must leave it as it was. */
  test('keeps its notes as they were when a plane is saved with only ink changed', async () => {
    const { scanCanvas } = await import('./scan-canvas')
    await space({ 'Plan.md': '# Plan' })
    const plane = (strokes: number) =>
      JSON.stringify({
        nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'Plan.md' }],
        edges: [],
        nib: {
          version: 1,
          icon: 'rocket',
          ink: Array.from({ length: strokes }, (_, one) => ({ id: `s${String(one)}`, points: [] })),
        },
      })

    links.noteSaved(at('Board.canvas'), plane(1))
    await vi.waitFor(() => expect(links.iconOf(at('Board.canvas'))).toBe('rocket'))
    const before = links.index(null).notes

    links.noteSaved(at('Board.canvas'), plane(2))
    await import('./scan-canvas')
    await Promise.resolve()

    expect(scanCanvas('Board.canvas', plane(2)).icon).toBe('rocket')
    expect(links.index(null).notes).toBe(before)
  })

  /** The other way a scan stops being the one anybody is waiting for: the window
   *  has no space open at all any more. */
  test('leaves a window with no space open empty when the rows land', async () => {
    const scan = await opening({ 'Plan.md': '# Plan' })
    links.clear()
    await scan.land()

    expect(links.rootOf()).toBeNull()
    expect(links.index(null).notes).toEqual([])
    expect(links.scanning).toBe(false)
  })

  test('says it is reading until the rows land, and no longer', async () => {
    const scan = await opening({ 'Plan.md': '# Plan' })
    expect(links.scanning).toBe(true)

    const waited = links.scanned()
    await scan.land()

    await expect(waited).resolves.toBeUndefined()
    expect(links.scanning).toBe(false)
  })

  /** Whoever waits for the scan waits for *their* scan. The one field that says
   *  how a waiter is told belongs to whichever space asked last, so a scan that
   *  finds itself out of date used to let go of the new space's waiters on its way
   *  out - and the tag tree read an index that held nothing yet. */
  test('does not let go of the next space’s waiters on its own way out', async () => {
    const first = await opening({ 'Theirs.md': '# Theirs' }, '/one')
    const second = await opening({ 'Mine.md': '# Mine' }, '/two')

    let told = false
    void links.scanned().then(() => (told = true))

    await first.land()
    await Promise.resolve()
    expect(told).toBe(false)

    await second.land()
    await Promise.resolve()
    expect(told).toBe(true)
  })
})

describe('a space of two thousand notes', () => {
  /** Two frames. Measured here at 3 ms cold and under 1 ms warm, so this is a
   *  ceiling with room for a loaded runner, not the expectation. */

  const many = () => {
    const built: Record<string, string> = { 'Plan.md': '# Plan' }
    for (let one = 0; one < 2000; one++) {
      built[`folder${one % 20}/Note ${one}.md`] =
        one % 5 === 0
          ? `# Note ${one}\n\nsee [[Plan]] and [[Note ${one + 1}]]\n`
          : `# Note ${one}\n\nnothing in particular about the plan\n`
    }
    return built
  }

  test('answers for a large space', async () => {
    await space(many())

    // Measured by hand at 3 ms cold; a clock in a test only reports the
    // machine's mood, so the answers are what is checked.
    expect(links.backlinks(at('Plan.md'))).toHaveLength(400)
    expect(links.outgoing(at('folder0/Note 0.md'))).toHaveLength(2)
  })

  test('a note saved is read on its own, not the space', async () => {
    await space(many())

    links.noteSaved(at('folder0/Note 0.md'), '# Note 0\n\nsee [[Plan]]\n')
    expect(links.outgoing(at('folder0/Note 0.md'))).toHaveLength(1)
  })
})

describe('what the editor is told about the tags', () => {
  test('every tag of the space, with the notes under each', async () => {
    await space({
      'Plan.md': '---\ntags: [work/nib]\n---\n\n# Plan\n\nwords #work/nib again\n',
      'One.md': 'filed under #work\n',
      'Two.md': 'and #reading\n',
    })

    expect(links.index(null).tags).toEqual([
      // A note counts once for a tag however often it writes it, and a nested
      // tag counts towards every level above it.
      { tag: 'work', notes: 2 },
      { tag: 'reading', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })

  test('a tag written now is offered now', async () => {
    await space({ 'Plan.md': '# Plan\n' })
    expect(links.index(null).tags).toEqual([])

    links.noteSaved(at('Plan.md'), '# Plan\n\n#later\n')
    expect(links.index(null).tags).toEqual([{ tag: 'later', notes: 1 }])
  })
})

describe('the blocks the whole space holds', () => {
  test('are found by their own words, with the name each already carries', async () => {
    await space({
      'Plan.md': '# Plan\n\nthe second half of it ^a1b2c3\n',
      'One.md': '# One\n\nnothing about halves\n',
    })

    expect(await links.searchBlocks('second half', 10)).toEqual([
      // The name is the link's, not the row's: what is shown is what the line says.
      { path: 'Plan.md', line: 2, text: 'the second half of it', id: 'a1b2c3' },
    ])
  })

  /** The desktop's search reads a website shortcut's words too, and a shortcut is
   *  a file of `key=value` lines: a name written onto one of them is a title, a
   *  date or an icon spoiled, and a link to it points nowhere. */
  test('are only ever a note’s, never a website shortcut’s', async () => {
    await space({
      'Plan.md': '# Plan\n\nsvelte docs to read\n',
      'Docs.url': '[InternetShortcut]\r\nURL=https://svelte.dev/docs\r\nTitle=Svelte docs\r\n',
    })

    expect((await links.searchBlocks('svelte docs', 10)).map((one) => one.path)).toEqual([
      'Plan.md',
    ])
  })

  test('a word too short to search for finds nothing, and asks nothing', async () => {
    await space({ 'Plan.md': '# Plan\n\na line\n' })

    expect(await links.searchBlocks('a', 10)).toEqual([])
  })

  test('leave out the notes the space leaves out', async () => {
    await space({
      'Plan.md': '# Plan\n\nthe second half of it\n',
      'archive/Old.md': '# Old\n\nthe second half of that\n',
    })

    const { workspace } = await import('./workspace.svelte')
    // The list itself is kept per space on the device, and there is no space open
    // here: what matters is that the search is asked to skip what it holds.
    const left = vi.spyOn(workspace.excluded, 'of').mockReturnValue(['archive'])

    try {
      expect((await links.searchBlocks('second half', 10)).map((one) => one.path)).toEqual([
        'Plan.md',
      ])
    } finally {
      left.mockRestore()
    }
  })
})

describe('renaming a note rewrites the links to it', () => {
  /** A canvas is JSON: its file cards name a note by path, and a text card's words
   *  sit inside a string. Rewritten as text, the cards kept the old path and a name
   *  with a quote in it ended the string early, which is a plane that no longer opens. */
  test('on a canvas, its file cards and its text cards alike, as JSON', async () => {
    const card = { x: 0, y: 0, width: 10, height: 10 }
    const board = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: 'Plan.md', ...card },
        { id: 'b', type: 'text', text: 'see [[Plan]]', ...card },
      ],
      edges: [],
    })
    await import('./scan-canvas')
    await space({ 'Plan.md': '# Plan' }, ['Board.canvas'])
    notes['Board.canvas'] = board
    links.canvasRead(at('Board.canvas'), board)
    await vi.waitFor(() =>
      expect(links.backlinks(at('Plan.md')).map((one) => one.path)).toContain('Board.canvas'),
    )

    expect(await links.retarget(at('Plan.md'), at('Road "x".md'), ROOT)).toBe(1)

    const after = JSON.parse(notes['Board.canvas'] ?? '') as { nodes: Record<string, string>[] }
    expect(after.nodes.map((one) => one.file ?? one.text)).toEqual([
      'Road "x".md',
      'see [[Road "x"]]',
    ])
  })

  test('every note that pointed at it, and no others', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] now',
      'Two.md': 'and [the plan](Plan.md)',
      'Three.md': 'nothing here',
    })

    const touched = await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)

    expect(touched).toBe(2)
    expect(notes['One.md']).toBe('see [[Roadmap]] now')
    expect(notes['Two.md']).toBe('and [the plan](Roadmap.md)')
    expect(notes['Three.md']).toBe('nothing here')
    expect(written.sort()).toEqual(['One.md', 'Two.md'])
  })

  test('a note that cannot be written keeps its link, and the others are rewritten (#537)', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] now',
      'Locked.md': 'also [[Plan]]',
      'Two.md': 'and [the plan](Plan.md)',
    })
    unwritable.add('Locked.md')

    try {
      // Thrown, it undid the move that asked for it; see pages/from-pdf.ts.
      const touched = await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)

      expect(touched).toBe(2)
      expect(notes['Locked.md']).toBe('also [[Plan]]')
      expect(notes['One.md']).toBe('see [[Roadmap]] now')
      expect(notes['Two.md']).toBe('and [the plan](Roadmap.md)')
    } finally {
      unwritable.clear()
    }
  })

  test('one snapshot per note it touched, and none for the rest', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]', 'Two.md': 'nothing' })

    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    expect(snapshots).toEqual(['One.md'])
  })

  test('the index knows the new links straight away', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]' })

    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    links.notesMoved(at('Plan.md'), at('Roadmap.md'))

    expect(links.backlinks(at('Roadmap.md')).map((one) => one.path)).toEqual(['One.md'])
    expect(links.backlinks(at('Plan.md'))).toEqual([])
  })

  test('rewriting back is the same rewrite the other way round', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[Plan]] now' })

    // The order the app does it in: the links are found against the space as it
    // was, and only then is the index told the note moved.
    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)
    links.notesMoved(at('Plan.md'), at('Roadmap.md'))

    await links.retarget(at('Roadmap.md'), at('Plan.md'), ROOT)
    links.notesMoved(at('Roadmap.md'), at('Plan.md'))

    expect(notes['One.md']).toBe('see [[Plan]] now')
  })

  /** A website is listed among the space's files as well as among its notes, and a
   *  link spelled with its ending is answered from the files. Renaming one used to
   *  write its ending into every link that had left it off, and the files kept the
   *  old name - so putting the name back found nothing to put back. Emil,
   *  2026-09-27. */
  test('a website renamed and put back keeps each link as it was written', async () => {
    const site = '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n'
    const before = 'see [[Docs]], [[Docs.url]] and [the docs](Docs.url)'
    await space({ 'Docs.url': site, 'One.md': before }, ['Docs.url'])

    await links.retarget(at('Docs.url'), at('Handbook.url'), ROOT)
    links.notesMoved(at('Docs.url'), at('Handbook.url'))
    expect(notes['One.md']).toBe('see [[Handbook]], [[Handbook.url]] and [the docs](Handbook.url)')

    await links.retarget(at('Handbook.url'), at('Docs.url'), ROOT)
    links.notesMoved(at('Handbook.url'), at('Docs.url'))
    expect(notes['One.md']).toBe(before)
  })

  /** The same for every file a link names by its ending: a PDF in a folder that
   *  moved answers to its new place at once, not after the next scan. */
  test('a file that moved is found where it went', async () => {
    await space({ 'One.md': 'see [[report.pdf]]' }, ['Papers/report.pdf'])

    links.notesMoved(at('Papers'), at('Archive'))

    expect(links.fileNamed('report.pdf')).toBe('Archive/report.pdf')
  })

  /** A bare `[[Plan]]` rewritten to `[[Road]]` opened another folder's `Road.md`
   *  once the space held one nearer to the link, or shallower: the rename sent the
   *  link to a note nobody renamed. Written with as much of the path as it takes to
   *  reach the renamed note, the way Obsidian writes one (B543). */
  test('onto a name another folder holds, with as much path as reaches it', async () => {
    await space({
      'A/Plan.md': '# Plan',
      'B/Road.md': '# other road',
      'B/x.md': 'see [[Plan]], [[Plan#Intro|the plan]], [[Plan#^b1]] and [p](../A/Plan.md)',
      'A/y.md': 'see [[Plan]]',
    })

    await links.retarget(at('A/Plan.md'), at('A/Road.md'), ROOT)
    links.notesMoved(at('A/Plan.md'), at('A/Road.md'))

    expect(notes['B/x.md']).toBe(
      'see [[A/Road]], [[A/Road#Intro|the plan]], [[A/Road#^b1]] and [p](../A/Road.md)',
    )
    // Beside the renamed note, the bare name still reaches it.
    expect(notes['A/y.md']).toBe('see [[Road]]')
    expect(links.outgoing(at('B/x.md')).map((one) => one.to)).toEqual([
      'A/Road.md',
      'A/Road.md',
      'A/Road.md',
      'A/Road.md',
    ])
  })

  test('onto a name the top of the space holds', async () => {
    await space({
      'Projects/Plan.md': '# Plan',
      'Road.md': '# root road',
      'x.md': 'see [[Plan]]',
      'Deep/Projects/Road.md': '# deeper',
    })

    await links.retarget(at('Projects/Plan.md'), at('Projects/Road.md'), ROOT)
    links.notesMoved(at('Projects/Plan.md'), at('Projects/Road.md'))

    expect(notes['x.md']).toBe('see [[Projects/Road]]')
    expect(links.outgoing(at('x.md'))[0]?.to).toBe('Projects/Road.md')
  })

  /** No name nor path reaches a note at the top of the space from beside a
   *  namesake, since a path is read as the end of one: only a path from the top,
   *  written with a leading slash, does. */
  test('at the top of the space, onto a name a folder holds', async () => {
    await space({
      'Plan.md': '# Plan',
      'B/Road.md': '# other road',
      'B/x.md': 'see [[Plan]], [[Plan#Intro|the plan]] and [p](../Plan.md)',
      'y.md': 'see [[Plan]]',
    })

    await links.retarget(at('Plan.md'), at('Road.md'), ROOT)
    links.notesMoved(at('Plan.md'), at('Road.md'))

    expect(notes['B/x.md']).toBe('see [[/Road]], [[/Road#Intro|the plan]] and [p](../Road.md)')
    expect(notes['y.md']).toBe('see [[Road]]')
    expect(links.outgoing(at('B/x.md')).map((one) => one.to)).toEqual([
      'Road.md',
      'Road.md',
      'Road.md',
    ])
  })

  test('moved to the top of the space and renamed, onto a name a folder holds', async () => {
    await space({ 'A/Plan.md': '# Plan', 'B/Road.md': '# other road', 'B/x.md': 'see [[Plan]]' })

    await links.retarget(at('A/Plan.md'), at('Road.md'), ROOT, () => null, { moved: true })
    links.notesMoved(at('A/Plan.md'), at('Road.md'))

    expect(notes['B/x.md']).toBe('see [[/Road]]')
    expect(links.outgoing(at('B/x.md'))[0]?.to).toBe('Road.md')
  })

  /** A path written out is read as the end of one too, so it can lose to a deeper
   *  folder of the same name beside the link. */
  test('a path written out, onto a name a nested folder beside it holds', async () => {
    await space({
      'A/Plan.md': '# Plan',
      'X/A/Road.md': '# deeper road',
      'X/A/n.md': 'see [[A/Plan]] and [[Plan]]',
    })

    await links.retarget(at('A/Plan.md'), at('A/Road.md'), ROOT)
    links.notesMoved(at('A/Plan.md'), at('A/Road.md'))

    expect(notes['X/A/n.md']).toBe('see [[/A/Road]] and [[/A/Road]]')
    expect(links.outgoing(at('X/A/n.md')).map((one) => one.to)).toEqual([
      'A/Road.md',
      'A/Road.md',
    ])
  })

  test('a link written from the top of the space stays written so', async () => {
    await space({ 'A/Plan.md': '# Plan', 'x.md': 'see [[/A/Plan]]' })

    await links.retarget(at('A/Plan.md'), at('C/Road.md'), ROOT, () => null, { moved: true })
    links.notesMoved(at('A/Plan.md'), at('C/Road.md'))

    expect(notes['x.md']).toBe('see [[/C/Road]]')
    expect(links.outgoing(at('x.md'))[0]?.to).toBe('C/Road.md')
  })

  test('a file onto a name the top of the space holds', async () => {
    await space({ 'x.md': 'see [[paper.pdf]]' }, ['Papers/paper.pdf', 'notes.pdf'])

    await links.retarget(at('Papers/paper.pdf'), at('Papers/notes.pdf'), ROOT)

    expect(notes['x.md']).toBe('see [[Papers/notes.pdf]]')
  })

  test('a note whose name did not change is left alone', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]' })
    expect(await links.retarget(at('Plan.md'), at('Plan.md'), ROOT)).toBe(0)
  })
})

/** A link spelled with its ending - `[[Docs.url]]`, `[[report.pdf]]` - is answered
 *  from the files beside the notes, and a delete used to leave them alone: the link
 *  went on resolving to a file that was no longer there until the next scan. */
describe('a file deleted and put back', () => {
  const SITE = '[InternetShortcut]\r\nURL=https://svelte.dev/\r\n'

  test('stops answering a link the moment it goes', async () => {
    await space({ 'Docs.url': SITE, 'One.md': 'see [[Docs.url]]' }, [
      'Docs.url',
      'Papers/report.pdf',
    ])

    links.noteGone(at('Docs.url'))
    links.noteGone(at('Papers'))

    expect(links.fileNamed('Docs.url')).toBeNull()
    expect(links.fileNamed('report.pdf')).toBeNull()
    expect(links.index(null).files).toEqual([])
  })

  test('answers again the moment it is back, by its name and by its ending', async () => {
    await space({ 'Docs.url': SITE, 'One.md': 'see [[Docs]] and [[Docs.url]]' }, ['Docs.url'])
    links.noteGone(at('Docs.url'))
    expect(links.backlinks(at('Docs.url'))).toEqual([])

    await links.cameBack(at('Docs.url'), false)

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
    expect(links.backlinks(at('Docs.url')).map((one) => one.path)).toEqual(['One.md', 'One.md'])
  })

  test('a file whose words the index does not read is listed and not read', async () => {
    await space({ 'One.md': 'see [[report.pdf]]' }, ['report.pdf'])
    links.noteGone(at('report.pdf'))
    reads = 0

    await links.cameBack(at('report.pdf'), false)

    expect(links.fileNamed('report.pdf')).toBe('report.pdf')
    expect(reads).toBe(0)
  })

  test('a folder brings everything in it back, notes and files', async () => {
    await space({ 'Papers/Notes.md': '# Notes', 'One.md': 'see [[Notes]] and [[report.pdf]]' }, [
      'Papers/report.pdf',
    ])
    links.noteGone(at('Papers'))
    expect(links.backlinks(at('Papers/Notes.md'))).toEqual([])

    await links.cameBack(at('Papers'), true)

    expect(links.fileNamed('report.pdf')).toBe('Papers/report.pdf')
    expect(links.backlinks(at('Papers/Notes.md')).map((one) => one.path)).toEqual(['One.md'])
  })

  /** A website converted from a note, or written for the first time, is a file the
   *  space holds from the moment it is written, not from the next scan. */
  test('a website written is a file there to link to', async () => {
    await space({ 'One.md': 'see [[Docs.url]]' })

    links.noteSaved(at('Docs.url'), SITE)

    expect(links.fileNamed('Docs.url')).toBe('Docs.url')
  })
})

describe('naming a block of another note', () => {
  test('writes the name at the end of the block and answers with it', async () => {
    await space({ 'Plan.md': '# Plan\n\nfirst line\nsecond line\n\nanother block\n' })

    const id = await links.nameBlock('Plan.md', 2, `${ROOT}/Note.md`)
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    expect(notes['Plan.md']).toBe(
      `# Plan\n\nfirst line\nsecond line ^${id ?? ''}\n\nanother block\n`,
    )
    expect(snapshots).toEqual(['Plan.md'])
  })

  test('a block that already has a name keeps it', async () => {
    await space({ 'Plan.md': '# Plan\n\na line ^kept\n' })

    expect(await links.nameBlock('Plan.md', 2, `${ROOT}/Note.md`)).toBe('kept')
    expect(written).toEqual([])
  })

  test('the name it gives is one the note has not used', async () => {
    await space({ 'Plan.md': 'one ^aaaaaa\n\ntwo\n' })

    const id = await links.nameBlock('Plan.md', 2, `${ROOT}/Note.md`)
    expect(id).not.toBe('aaaaaa')
  })

  test('names nothing in a file that is not a note, and writes nothing there', async () => {
    const shortcut = '[InternetShortcut]\r\nURL=https://svelte.dev/docs\r\nTitle=Svelte docs\r\n'
    await space({ 'Docs.url': shortcut })

    expect(await links.nameBlock('Docs.url', 2, ROOT)).toBeNull()
    expect(written).toEqual([])
    expect(notes['Docs.url']).toBe(shortcut)
  })

  test('keeps the line ending of a note written with CRLF', async () => {
    await space({ 'Plan.md': '# Plan\r\n\r\nfirst line\r\nsecond line\r\n' })

    const id = await links.nameBlock('Plan.md', 2, ROOT)
    expect(notes['Plan.md']).toBe(`# Plan\r\n\r\nfirst line\r\nsecond line ^${id ?? ''}\r\n`)
  })

  /** A tab of another space is handed the open space's notes, so the root asked
   *  about may be one shared to be read: its copy here would stop being the space's,
   *  and the sync would refuse the change on every pass. */
  test('names nothing in a space shared to be read, and writes nothing there', async () => {
    await space({ 'Plan.md': '# Plan\n\na line\n' })
    readOnly.add(ROOT)

    try {
      expect(await links.nameBlock('Plan.md', 2, ROOT)).toBeNull()
      expect(written).toEqual([])
      expect(snapshots).toEqual([])
    } finally {
      readOnly.clear()
    }
  })
})

/** What an embed, a canvas file card and an export bring in: the note's words, and
 *  whether its own HTML is words, which is the note's answer and not the page's. */
describe('the note an embed names', () => {
  test('says whether its HTML is words, by where it sits', async () => {
    await space({ 'Plan.md': '<b>mine</b>', 'Shared/Theirs.md': '<form>x</form>' })
    theirs.add(`${ROOT}/Shared/Theirs.md`)
    try {
      expect(await links.embedNote('Plan', `${ROOT}/Today.md`)).toEqual({
        text: '<b>mine</b>',
        escapeHtml: false,
      })
      expect(await links.embedNote('Theirs', `${ROOT}/Today.md`)).toEqual({
        text: '<form>x</form>',
        escapeHtml: true,
      })
      expect(await links.embedNote('Missing', `${ROOT}/Today.md`)).toBeNull()
    } finally {
      theirs.clear()
    }
  })
})

describe('a picture named by an embed', () => {
  test('is found wherever in the space it lives', async () => {
    await space({ 'Plan.md': '![[shot.png]]' }, ['assets/deep/shot.png', 'other.png'])

    expect(links.fileNamed('shot.png')).toBe('assets/deep/shot.png')
    expect(links.fileNamed('other.png')).toBe('other.png')
    expect(links.fileNamed('missing.png')).toBeNull()
  })
})

/** The icon a row wears, which rides along on the same pass. A file list asks
 *  this once per row, so what it must never be is a read of the file. */
describe('the icon a note says it wears', () => {
  test('comes off the scan of the space', async () => {
    await space({
      'Plan.md': '---\nicon: rocket\n---\n\n# Plan',
      'Plain.md': '# Plain',
    })

    expect(links.iconOf(at('Plan.md'))).toBe('rocket')
    expect(links.iconOf(at('Plain.md'))).toBeNull()
  })

  test('as written, whichever convention wrote it', async () => {
    await space({
      'Obsidian.md': '---\nicon: LiFileText\n---\n',
      'Emoji.md': '---\nicon: 🚀\n---\n',
    })

    expect(links.iconOf(at('Obsidian.md'))).toBe('LiFileText')
    expect(links.iconOf(at('Emoji.md'))).toBe('🚀')
  })

  test('by the path a row knows, wherever the row is', async () => {
    await space({ 'ideas/Plan.md': '---\nicon: rocket\n---\n' })

    // The tree knows where the file is; a bookmark and a search hit know it
    // relative to the space.
    expect(links.iconOf(at('ideas/Plan.md'))).toBe('rocket')
    expect(links.iconOf('ideas/Plan.md')).toBe('rocket')
  })

  test('and changes the moment the note does, without the space being read again', async () => {
    await space({ 'Plan.md': '# Plan' })
    expect(links.iconOf(at('Plan.md'))).toBeNull()

    links.noteSaved(at('Plan.md'), '---\nicon: anchor\n---\n\n# Plan')
    expect(links.iconOf(at('Plan.md'))).toBe('anchor')

    links.noteSaved(at('Plan.md'), '# Plan')
    expect(links.iconOf(at('Plan.md'))).toBeNull()
  })

  test('a note outside the space wears nothing', async () => {
    await space({ 'Plan.md': '---\nicon: rocket\n---\n' })
    expect(links.iconOf('/elsewhere/Plan.md')).toBeNull()
  })
})

/** The tags of a space, counted off the index rather than read off the disk.
 *
 *  Asking the space read every body again to count them - twenty-two megabytes of
 *  strings on the thread the search panel was opening on. The scan that finds a
 *  note's links writes down its tags on the way past, so the answer is already in
 *  hand. What is counted here is rows read: none. */
describe("a space's tags", () => {
  test('come off the index without a row being read', async () => {
    await space({
      'Plan.md': '#work/nib and #paper, and #work again\n',
      'Ink.md': '#paper on #paper\n',
      'Kestrel.md': 'nothing tagged here\n',
    })

    const before = reads
    // A row per level: Plan is one note under `work` and under `work/nib` both, and
    // it is one note under `work` whether it wrote the tag once or twice.
    expect(links.spaceTags).toEqual([
      { tag: 'paper', notes: 2 },
      { tag: 'work', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])

    // Not one note read to answer it, however many times it is asked.
    expect(links.spaceTags).toEqual(links.spaceTags)
    expect(reads - before).toBe(0)
  })

  test('count the notes carrying one, not the times it was written', async () => {
    await space({ 'Plan.md': '#work #work #work\n', 'Ink.md': '#Work\n' })

    // Three uses in one note and one in another, spelled two ways: two notes.
    expect(links.spaceTags).toEqual([{ tag: 'work', notes: 2 }])
  })

  test('and a note under two branches of one tag counts once for the branch', async () => {
    await space({ 'Plan.md': '#work/nib and #work/lab\n' })

    expect(links.spaceTags).toEqual([
      { tag: 'work', notes: 1 },
      { tag: 'work/lab', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })

  test('and follow a note being saved, without the space being read again', async () => {
    await space({ 'Plan.md': '#work\n' })
    const before = reads

    links.noteSaved(at('Plan.md'), '#paper\n')
    expect(links.spaceTags).toEqual([{ tag: 'paper', notes: 1 }])
    expect(reads - before).toBe(0)
  })

  test('and are the same list the editor is handed for its own popup', async () => {
    await space({ 'Plan.md': '#work/nib\n', 'Ink.md': '#paper\n' })

    // One answer, two surfaces: the `#` completion reads it off the index it is
    // handed, and the tag tree reads it off the store. Neither counts its own.
    expect(links.index(at('Plan.md')).tags).toEqual(links.spaceTags)
    expect(links.spaceTags).toEqual([
      { tag: 'paper', notes: 1 },
      { tag: 'work', notes: 1 },
      { tag: 'work/nib', notes: 1 },
    ])
  })
})

/** What drawing a page of links costs, counted.
 *
 *  Every surface that draws one asks `targetOf`, and the thing it must not do is
 *  ask the space about each link in turn. The reading view used to: it filtered
 *  every note in the space per link, so a note of eighteen hundred links over five
 *  thousand notes compared nine million paths to draw one page - 1.7 seconds of the
 *  five that page took, all of it folding paths. Counted rather than timed, for the
 *  reason the counter's own comment gives. */
describe('resolving a page of links', () => {
  /** A space of five hundred notes, and one note linking to three hundred of them,
   *  which is the shape of a long note with a link every few lines. */
  async function page() {
    const contents: Record<string, string> = {}
    for (let one = 0; one < 500; one++) contents[`note-${one}.md`] = `# Note ${one}\n`

    const lines: string[] = []
    for (let one = 0; one < 300; one++) lines.push(`See [[note-${one}]] on this.`)
    contents['long.md'] = lines.join('\n')

    await space(contents)
    return lines.map((_, one) => `note-${one}`)
  }

  test('compares the links, not the links times the space', async () => {
    const targets = await page()
    // What asking the space per link walks, per link: all of it.
    expect(links.index(at('long.md')).notes).toHaveLength(501)

    const before = links.examined
    for (const target of targets) links.targetOf(at('long.md'), { kind: 'wikilink', target })

    // One candidate per link and no more: three hundred comparisons, against the
    // hundred and fifty thousand the same page cost when every link asked the
    // whole space.
    expect(links.examined - before).toBe(targets.length)
  })

  test('asks once for a target however many links name it', async () => {
    const targets = await page()

    const before = links.examined
    for (let round = 0; round < 5; round++) {
      for (const target of targets) links.targetOf(at('long.md'), { kind: 'wikilink', target })
    }

    // Five passes over the same page, and only the first one asks: what a target
    // means is remembered until the space changes.
    expect(links.examined - before).toBe(targets.length)
  })

  test('answers what walking the whole space answers', async () => {
    const { resolveNote } = await import('@nib/editor')

    await space({
      'Plan.md': '# Plan',
      'ideas/Plan.md': '# The other plan',
      'ideas/Later.md': '---\naliases:\n  - Eventually\n---\n',
      'Notes/Today.md': 'a note that links out',
    })

    const asked = ['Plan', 'ideas/Plan', 'Later', 'ideas/later', 'Eventually', 'Nowhere', 'PLAN']

    for (const from of ['Notes/Today.md', 'ideas/Later.md']) {
      const index = links.index(at(from))
      for (const target of asked) {
        expect(links.targetOf(at(from), { kind: 'wikilink', target })).toBe(
          resolveNote(index, target)?.path ?? null,
        )
      }
    }
  })
})

/** A folder renamed or moved takes every note in it along, and a link that spelled
 *  out a path through the folder used to be left on the old one: `retarget` only
 *  asked which links named the folder itself, and no link does. */
describe('a folder renamed', () => {
  test('rewrites the links that spell out a path through it, and no others', async () => {
    const card = { x: 0, y: 0, width: 10, height: 10 }
    const board = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: 'Projects/Plan.md', ...card },
        { id: 'b', type: 'file', file: 'Projects/shot.png', ...card },
      ],
      edges: [],
    })
    await import('./scan-canvas')
    await space(
      {
        'Projects/Plan.md': '# Plan',
        'One.md': 'see [[Projects/Plan]] and [p](Projects/Plan.md) and ![](Projects/shot.png)\n',
        'Bare.md': 'see [[Plan]] and [p](Plan.md)\n',
      },
      ['Projects/shot.png', 'Board.canvas'],
    )
    notes['Board.canvas'] = board
    links.canvasRead(at('Board.canvas'), board)
    await vi.waitFor(() =>
      expect(links.backlinks(at('Projects/Plan.md')).map((one) => one.path)).toContain(
        'Board.canvas',
      ),
    )

    const touched = await links.retarget(at('Projects'), at('Work'), ROOT, () => null, {
      moved: true,
    })

    expect(touched).toBe(2)
    expect(notes['One.md']).toBe('see [[Work/Plan]] and [p](Work/Plan.md) and ![](Work/shot.png)\n')
    // A bare name still finds the note wherever its folder went.
    expect(notes['Bare.md']).toBe('see [[Plan]] and [p](Plan.md)\n')
    const after = JSON.parse(notes['Board.canvas'] ?? '') as { nodes: Record<string, string>[] }
    expect(after.nodes.map((one) => one.file)).toEqual(['Work/Plan.md', 'Work/shot.png'])
  })

  test('moved deeper, its notes point out of it from where they now are', async () => {
    await space({
      'Projects/Plan.md': 'see [o](../Other.md), [s](Sub.md) and [[Projects/Sub]]\n',
      'Projects/Sub.md': '# Sub',
      'Other.md': '# Other',
    })
    notes['Area/Projects/Plan.md'] = notes['Projects/Plan.md'] ?? ''

    await links.retarget(at('Projects'), at('Area/Projects'), ROOT, () => null, { moved: true })

    expect(notes['Area/Projects/Plan.md']).toBe(
      // The wikilink still names its note by the end of its path.
      'see [o](../../Other.md), [s](Sub.md) and [[Projects/Sub]]\n',
    )
  })
})

/** A note moved to another folder took its relative links with it unchanged, and
 *  each then named a path beside its new folder that held nothing. */
describe('a note moved to another folder', () => {
  test('keeps its pictures and markdown links reaching their files', async () => {
    await space(
      {
        'Plan.md': '# Plan\n\n![shot](assets/abc.png)\n\nsee [Other](Other.md) and [[Other]]\n',
        'Other.md': '# Other',
      },
      ['assets/abc.png'],
    )
    notes['Projects/Plan.md'] = notes['Plan.md'] ?? ''

    await links.retarget(at('Plan.md'), at('Projects/Plan.md'), ROOT, () => null, { moved: true })

    expect(notes['Projects/Plan.md']).toBe(
      '# Plan\n\n![shot](../assets/abc.png)\n\nsee [Other](../Other.md) and [[Other]]\n',
    )
  })

  test('and moved back to the top, climbs no further than it has to', async () => {
    await space(
      { 'Projects/Plan.md': '![shot](../assets/abc.png) [o](../Other.md)\n', 'Other.md': '#' },
      ['assets/abc.png'],
    )
    notes['Plan.md'] = notes['Projects/Plan.md'] ?? ''

    await links.retarget(at('Projects/Plan.md'), at('Plan.md'), ROOT, () => null, { moved: true })

    expect(notes['Plan.md']).toBe('![shot](assets/abc.png) [o](Other.md)\n')
  })

  test('renamed in its own folder, its own links are left as they were', async () => {
    await space({ 'Plan.md': '![shot](assets/abc.png) [o](Other.md)\n', 'Other.md': '#' }, [
      'assets/abc.png',
    ])
    notes['Goal.md'] = notes['Plan.md'] ?? ''

    expect(
      await links.retarget(at('Plan.md'), at('Goal.md'), ROOT, () => null, { moved: true }),
    ).toBe(0)
    expect(notes['Goal.md']).toBe('![shot](assets/abc.png) [o](Other.md)\n')
  })
})

/** A note with one link to rewrite has every link in it read again, and the others
 *  pointing into what moved were written over as well: an alias as the filename, a
 *  name in another case in the case of the file. */
describe('a folder renamed, in a note that also links into it by other names', () => {
  test('rewrites the path and leaves an alias and another case as written', async () => {
    await space({
      'Projects/Plan.md': '---\naliases: [The Goal]\n---\n# Plan',
      'One.md': '[[Projects/Plan]] [[The Goal]] [[plan]] [p](projects/plan.md)\n',
    })

    await links.retarget(at('Projects'), at('Work'), ROOT, () => null, { moved: true })

    expect(notes['One.md']).toBe('[[Work/Plan]] [[The Goal]] [[plan]] [p](Work/Plan.md)\n')
  })

  test('and a note renamed leaves an alias to it as written', async () => {
    await space({
      'Plan.md': '---\naliases: [The Goal]\n---\n# Plan',
      'One.md': '[[Plan]] [[The Goal]]\n',
    })

    await links.retarget(at('Plan.md'), at('Roadmap.md'), ROOT)

    expect(notes['One.md']).toBe('[[Roadmap]] [[The Goal]]\n')
  })
})

/** The resolver reads a target trimmed and a markdown path without its trailing
 *  slash; the rewrite asked about the target as written, so it never found these. */
describe('a link written with spaces inside its brackets or a slash at its end', () => {
  test('is rewritten when the picture it names is renamed', async () => {
    await space({ 'One.md': '![[ abc.png ]] ![](assets/abc.png/)\n' }, ['assets/abc.png'])

    await links.retarget(at('assets/abc.png'), at('assets/def.png'), ROOT, () => null, {
      moved: true,
    })

    expect(notes['One.md']).toBe('![[ def.png ]] ![](assets/def.png)\n')
  })

  test('is rewritten when the note it names is renamed', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': 'see [[ Plan ]]\n' })

    await links.retarget(at('Plan.md'), at('Goal.md'), ROOT)

    expect(notes['One.md']).toBe('see [[ Goal ]]\n')
  })
})

/** A rewrite tells the index what it wrote once it has gone through the whole space,
 *  and a note saved after it was rewritten and before the pass ended had its newer
 *  words put back to what the pass wrote: its new links went missing from the index. */
describe('a note saved while a folder rename is still rewriting the space', () => {
  test('keeps what was saved in the index', async () => {
    await space({
      'Journal/A.md': '# A',
      'Foo.md': '# Foo',
      'T0.md': 'see [[Journal/A]]\n',
    })
    afterWrite = (relative) => {
      if (relative === 'T0.md') links.noteSaved(at('T0.md'), 'see [[Diary/A]] [[Foo]]\n')
    }

    try {
      await links.retarget(at('Journal'), at('Diary'), ROOT, () => null, { moved: true })
    } finally {
      afterWrite = null
    }

    expect(links.backlinks(at('Foo.md')).map((one) => one.path)).toEqual(['T0.md'])
  })

  test('and a note saved before the pass reached it is rewritten in the index too', async () => {
    await space({
      'Journal/A.md': '# A',
      'T0.md': 'see [[Journal/A]]\n',
      'T1.md': 'see [[Journal/A]]\n',
    })
    afterWrite = (relative) => {
      if (relative !== 'T0.md') return
      notes['T1.md'] = 'see [[Journal/A]] more\n'
      links.noteSaved(at('T1.md'), 'see [[Journal/A]] more\n')
    }

    try {
      await links.retarget(at('Journal'), at('Diary'), ROOT, () => null, { moved: true })
    } finally {
      afterWrite = null
    }
    links.notesMoved(at('Journal'), at('Diary'))

    expect(notes['T1.md']).toBe('see [[Diary/A]] more\n')
    expect(links.backlinks(at('Diary/A.md')).map((one) => one.path)).toEqual(['T0.md', 'T1.md'])
  })
})

describe('a folder renamed, in a note inside it that is rewritten', () => {
  test('keeps a relative link that still reaches as it was written', async () => {
    await space({ 'Journal/A.md': '[[Journal/B]] [b2](./B.md)\n', 'Journal/B.md': '# B' })
    notes['Diary/A.md'] = notes['Journal/A.md'] ?? ''

    await links.retarget(at('Journal'), at('Diary'), ROOT, () => null, { moved: true })

    expect(notes['Diary/A.md']).toBe('[[Diary/B]] [b2](./B.md)\n')
  })
})
