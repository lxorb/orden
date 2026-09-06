import { beforeEach, describe, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'

/** The index reads a space through the platform shim. Under node there is none,
 *  so a folder of notes stands in for one - which is why the store is imported
 *  further down rather than at the top. */

const ROOT = '/space'

let notes: Record<string, string> = {}
let files: string[] = []
/** Every note that was written, so a rewrite can be read back. */
let written: string[] = []
/** Every note a snapshot was taken of, so "one snapshot per touched note" is a
 *  thing the test can see rather than a thing the comment claims. */
let snapshots: string[] = []

const stringOf = (args: Record<string, unknown> | undefined, name: string) => {
  const value = args?.[name]
  return typeof value === 'string' ? value : ''
}

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = stringOf(args, 'path')

    switch (command) {
      case 'scan_links':
        return {
          notes: Object.entries(notes).map(([one, content]) => scanNote(one, content)),
          files,
        }
      case 'read_note': {
        const relative = path.slice(ROOT.length + 1)
        const doc = notes[relative]
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        return doc
      }
      case 'write_note': {
        const relative = path.slice(ROOT.length + 1)
        notes[relative] = stringOf(args, 'content')
        written.push(relative)
        return undefined
      }
      case 'snapshot_note':
        snapshots.push(path.slice(ROOT.length + 1))
        return undefined
      case 'search_space': {
        const query = stringOf(args, 'query').toLowerCase()
        const hits: { path: string; name: string; line: number; text: string }[] = []

        for (const [one, content] of Object.entries(notes)) {
          content.split('\n').forEach((line, index) => {
            if (!line.toLowerCase().includes(query)) return
            hits.push({
              path: `${ROOT}/${one}`,
              name: one.split('/').pop() ?? one,
              line: index,
              text: line.trim(),
            })
          })
        }

        return hits
      }
      default:
        return undefined
    }
  },
}))

const { links } = await import('./link-index.svelte')

async function space(contents: Record<string, string>, others: string[] = []) {
  notes = { ...contents }
  files = [...others]
  written = []
  snapshots = []
  await links.build(ROOT)
}

const at = (relative: string) => `${ROOT}/${relative}`

beforeEach(() => {
  links.clear()
})

describe('backlinks', () => {
  test('find every note that points here, whichever way it was written', async () => {
    await space({
      'Plan.md': '# Plan',
      'One.md': 'see [[Plan]] for more',
      'Two.md': 'see [the plan](Plan.md)',
      'Three.md': 'nothing to do with it',
    })

    expect(links.backlinks(at('Plan.md')).map((one) => one.name)).toEqual(['One', 'Two'])
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
      expect.objectContaining({ target: 'Plan', to: 'Plan.md', name: 'Plan' }),
      expect.objectContaining({ target: 'Nowhere', to: null, name: 'Nowhere' }),
      expect.objectContaining({ target: 'ideas/Spark', to: 'ideas/Spark.md', name: 'Spark' }),
    ])
  })

  test('a link into the note itself is not a link out', async () => {
    await space({ 'One.md': '# Today\n\nsee [[#Today]]' })
    expect(links.outgoing(at('One.md'))).toEqual([])
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
})

describe('a space of two thousand notes', () => {
  /** Two frames. Measured here at 3 ms cold and under 1 ms warm, so this is a
   *  ceiling with room for a loaded runner, not the expectation. */
  const BUDGET = 33

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

  test('opens the panel well inside a frame', async () => {
    await space(many())

    const began = performance.now()
    const back = links.backlinks(at('Plan.md'))
    const out = links.outgoing(at('folder0/Note 0.md'))
    const took = performance.now() - began

    expect(back).toHaveLength(400)
    expect(out).toHaveLength(2)
    expect(took).toBeLessThan(BUDGET)
  })

  test('a note saved costs nothing like a rescan', async () => {
    await space(many())

    const began = performance.now()
    links.noteSaved(at('folder0/Note 0.md'), '# Note 0\n\nsee [[Plan]]\n')
    expect(performance.now() - began).toBeLessThan(BUDGET)
  })
})

describe('renaming a note rewrites the links to it', () => {
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

  test('a note whose name did not change is left alone', async () => {
    await space({ 'Plan.md': '# Plan', 'One.md': '[[Plan]]' })
    expect(await links.retarget(at('Plan.md'), at('Plan.md'), ROOT)).toBe(0)
  })
})

describe('naming a block of another note', () => {
  test('writes the name at the end of the block and answers with it', async () => {
    await space({ 'Plan.md': '# Plan\n\nfirst line\nsecond line\n\nanother block\n' })

    const id = await links.nameBlock('Plan.md', 2, ROOT)
    expect(id).toMatch(/^[a-z0-9]{6}$/)
    expect(notes['Plan.md']).toBe(
      `# Plan\n\nfirst line\nsecond line ^${id ?? ''}\n\nanother block\n`,
    )
    expect(snapshots).toEqual(['Plan.md'])
  })

  test('a block that already has a name keeps it', async () => {
    await space({ 'Plan.md': '# Plan\n\na line ^kept\n' })

    expect(await links.nameBlock('Plan.md', 2, ROOT)).toBe('kept')
    expect(written).toEqual([])
  })

  test('the name it gives is one the note has not used', async () => {
    await space({ 'Plan.md': 'one ^aaaaaa\n\ntwo\n' })

    const id = await links.nameBlock('Plan.md', 2, ROOT)
    expect(id).not.toBe('aaaaaa')
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
