import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const { firstVisiting, isHiddenTabs, movingOf, notices, ownerOf, spacesFor, workspace } =
  await import('../src/api')

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const LIB = join(HERE, '..')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const own = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
  dependsOn: string[]
  pending?: string[]
}

function layerOf(name: string): string | null {
  const file = join(LIB, name, 'module.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { layer: string }).layer
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = own.pending ?? []
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('it leans on no content or feature module, which reach it through its services instead', () => {
    const above = own.dependsOn.filter((name) => {
      const layer = layerOf(name)
      return layer !== null && layer !== 'foundation' && layer !== 'shell'
    })
    expect(above).toEqual([])
  })
})

describe('the workspace', () => {
  test('a blank note opens as the active tab, beside the ones already open', () => {
    workspace.openBlank('Plan', '# Plan')
    const first = workspace.active
    workspace.openBlank('Notes', '# Notes')
    const second = workspace.active

    expect([first?.name, second?.name]).toEqual(['Plan', 'Notes'])
    expect(workspace.activeTabId).toBe(second?.id)
    expect(workspace.tabs.map((one) => one.id)).toEqual(
      expect.arrayContaining([first?.id, second?.id]),
    )
  })
})

describe('its notices', () => {
  test('open through a door, and a failure told lingers until it is retried or dismissed', async () => {
    const { failed, gateNote } = await notices()
    let retried = 0
    failed.tell(() => retried++)
    expect(failed.retry).not.toBe(null)
    failed.again()
    expect(retried).toBe(1)
    expect(failed.retry).toBe(null)
    gateNote.show('Turned off')
    expect(gateNote.said).toBe('Turned off')
    gateNote.dismiss()
    expect(gateNote.said).toBe(null)
  })

  test('the first visit is fresh only once seeded and until it is answered', async () => {
    const { firstVisit } = await firstVisiting()
    expect(firstVisit.fresh).toBe(false)
    firstVisit.seeded()
    expect(firstVisit.fresh).toBe(true)
    firstVisit.answered()
    expect(firstVisit.fresh).toBe(false)
    firstVisit.seeded()
    expect(firstVisit.fresh).toBe(false)
  })
})

describe('where tabs may move', () => {
  const spaces = [
    { id: 'home', name: 'Home', root: '/notes/Home' },
    { id: 'work', name: 'Work', root: '/notes/Work' },
  ]
  const tab = (path: string | null) => movingOf({ path, note: { home: null, shared: null } })

  test('a file in one space is offered every other space it may be written to', () => {
    const where = { spaces, activeSpaceId: 'home' }
    expect(spacesFor([tab('/notes/Home/a.md')], where, () => true).map((one) => one.id)).toEqual([
      'work',
    ])
  })

  test('nowhere, when the file itself may not be written', () => {
    const where = { spaces, activeSpaceId: 'home' }
    const writable = (path: string) => !path.endsWith('a.md')
    expect(spacesFor([tab('/notes/Home/a.md')], where, writable)).toEqual([])
  })

  test('nowhere, with only one space', () => {
    expect(
      spacesFor(
        [tab('/notes/Home/a.md')],
        { spaces: spaces.slice(0, 1), activeSpaceId: 'home' },
        () => true,
      ),
    ).toEqual([])
  })

  test('a path belongs to the space whose folder holds it, a tab without one to its home', () => {
    expect(ownerOf('/notes/Work/b.md', null, spaces)).toBe('work')
    expect(ownerOf('/elsewhere/b.md', null, spaces)).toBeNull()
    expect(ownerOf(null, 'home', spaces)).toBe('home')
  })
})

describe('the hidden tabs choice', () => {
  test('hidden tabs run, pause or ask, and nothing else', () => {
    expect(['run', 'pause', 'ask', 'sleep', 1].map(isHiddenTabs)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })
})
