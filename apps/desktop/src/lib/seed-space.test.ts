import { describe, expect, test } from 'vitest'
import { AGENTS_SEED } from './agents-seed'
import { type Listed, untouchedSeedSpace } from './seed-space'
import { WELCOME } from './welcome'

const ROOT = '/spaces/Notes'

function file(name: string, root = ROOT): Listed {
  return { path: `${root}/${name}`, is_dir: false, children: [] }
}

function space(children: Listed[], root = ROOT): Listed {
  return { path: root, is_dir: true, children }
}

function disk(trees: Record<string, Listed>, words: Record<string, string>) {
  return {
    tree: (root: string) => Promise.resolve(trees[root] ?? null),
    note: (path: string) => Promise.resolve(words[path] ?? null),
  }
}

const SEEDS = {
  [`${ROOT}/Read me.md`]: WELCOME,
  [`${ROOT}/AGENTS.md`]: AGENTS_SEED,
}

describe('the default space', () => {
  test('holding only the welcome note and AGENTS.md as written is untouched', async () => {
    const read = disk({ [ROOT]: space([file('Read me.md'), file('AGENTS.md')]) }, SEEDS)
    expect(await untouchedSeedSpace(ROOT, [ROOT], read)).toBe(ROOT)
  })

  test('with fewer of them, the welcome note deleted, is untouched still', async () => {
    const read = disk({ [ROOT]: space([file('AGENTS.md')]) }, SEEDS)
    expect(await untouchedSeedSpace(ROOT, [ROOT], read)).toBe(ROOT)
  })

  test('with a word typed into the welcome note is the reader’s', async () => {
    const read = disk(
      { [ROOT]: space([file('Read me.md')]) },
      { [`${ROOT}/Read me.md`]: `${WELCOME}\nmy own line\n` },
    )
    expect(await untouchedSeedSpace(ROOT, [ROOT], read)).toBeNull()
  })

  test('with a note, a picture or a folder added is the reader’s', async () => {
    for (const added of [file('Plan.md'), file('shot.png')]) {
      const read = disk(
        { [ROOT]: space([file('Read me.md'), added]) },
        { ...SEEDS, [added.path]: 'mine' },
      )
      expect(await untouchedSeedSpace(ROOT, [ROOT], read), added.path).toBeNull()
    }
    const folder: Listed = { path: `${ROOT}/Ideas`, is_dir: true, children: [] }
    const read = disk({ [ROOT]: space([file('Read me.md'), folder]) }, SEEDS)
    expect(await untouchedSeedSpace(ROOT, [ROOT], read)).toBeNull()
  })

  test('renamed is the reader’s, though it holds only the seeds', async () => {
    const renamed = '/spaces/Journal'
    const read = disk(
      { [renamed]: space([file('Read me.md', renamed)], renamed) },
      { [`${renamed}/Read me.md`]: WELCOME },
    )
    expect(await untouchedSeedSpace(ROOT, [renamed], read)).toBeNull()
  })

  test('is never a space the reader made, whatever it is called', async () => {
    const read = disk({ [ROOT]: space([file('AGENTS.md')]) }, SEEDS)
    expect(await untouchedSeedSpace(null, [ROOT], read)).toBeNull()
    expect(await untouchedSeedSpace('/spaces/Other', [ROOT], read)).toBeNull()
  })

  test('that cannot be read is the reader’s', async () => {
    const unreadable = disk({ [ROOT]: space([file('Read me.md')]) }, {})
    expect(await untouchedSeedSpace(ROOT, [ROOT], unreadable)).toBeNull()
    expect(await untouchedSeedSpace(ROOT, [ROOT], disk({}, {}))).toBeNull()
  })
})
