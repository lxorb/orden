import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { providePort, type Shared } from '@orden/contracts'
import { afterEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  phone: false,
  shared: '',
  heard: new Map<string, unknown>(),
  opened: [] as string[],
  asked: [] as string[][],
  done: [] as string[],
}))

vi.mock('../../platform/src/api', () => ({
  onTheActivity: () => world.phone,
  answer: (name: string, heard: unknown) => void world.heard.set(name, heard),
  frameWord: () => Promise.resolve('word'),
  wordSaid: () => new Promise(() => undefined),
  method: (name: string) =>
    ({
      handed: () => '',
      shared: () => world.shared,
      sharedBytes: () => '',
      sharedDone: (word: string) => void world.done.push(word),
    })[name],
  log: () => undefined,
  joinPath: (root: string, name: string) => `${root}/${name}`,
}))
vi.mock('../../sharing/src/api', () => ({ canWriteAt: () => true }))
vi.mock('../../tasks-model/src/api', () => ({ todos: { todos: [] } }))
vi.mock('../../ui-kit/src/api', () => ({
  prompt: {
    choose: (question: { options: { id: string }[] }) => {
      world.asked.push(question.options.map((one) => one.id))
      return Promise.resolve('new')
    },
  },
}))
vi.mock('../../modes/src/api', () => ({ modes: { attachments: 'space' } }))
vi.mock('../../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../../commands/src/api', () => ({
  appCommands: () => [],
  putPicture: () => undefined,
  writeAtCaret: () => undefined,
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    spaces: [{ id: 'mine', name: 'Mine', root: '/mine' }],
    activeSpace: { id: 'mine', name: 'Mine', root: '/mine' },
    active: null,
    panes: { focusedId: 'a' },
    open: () => Promise.resolve(),
    openEntry: (path: string) => {
      world.opened.push(path)
      return Promise.resolve()
    },
  },
}))

const { startHanded } = await import('../src/api')

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function reached(): string[] {
  return sources(SRC).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap((found) => {
      const target = resolve(dirname(file), found[1] ?? '')
      if (target.startsWith(SRC)) return []
      const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
      return [relative(ROOT, path ?? target)]
    }),
  )
}

const SHARE = JSON.stringify({ items: [{ name: '', mime: 'text/plain', text: 'a link' }] })

afterEach(() => {
  world.phone = false
  world.shared = ''
  world.heard.clear()
  world.opened = []
  world.asked = []
  world.done = []
})

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
      pending?: string[]
    }
    const pending = json.pending ?? []
    const past = reached().filter(
      (path) => !/\/[a-z-]+\/src\/api(\.ts)?$/.test(path) && !pending.includes(path),
    )
    expect(past).toEqual([])
  })

  test('reaches the import only through its port', () => {
    expect(reached().filter((path) => path.includes('/import/'))).toEqual([])
  })
})

describe('the handover', () => {
  test('off the phone, listens for nothing', () => {
    world.shared = SHARE
    const stop = startHanded()
    expect(world.heard.size).toBe(0)
    stop()
    expect(world.done).toEqual([])
  })

  test('a share of words chosen as a new note lands through the import port and opens', async () => {
    const landed: { root: string; folder: string; words: string }[] = []
    const unbind = providePort('import.bring', {
      here: () => Promise.resolve(new Set()),
      browser: () => Promise.resolve([]),
      notes: () => Promise.resolve({ picked: false, trouble: null }),
      shared: (json) =>
        Promise.resolve(
          json === SHARE
            ? ({
                action: '',
                subject: '',
                items: [{ name: '', mime: 'text/plain', size: 0, text: 'a link' }],
                title: 'A link',
                words: 'a link',
                markdown: 'a link',
                task: 'a link',
                fitsInNote: true,
              } satisfies Shared)
            : null,
        ),
      landShared: (shared, _bytes, root, folder) => {
        landed.push({ root, folder, words: shared.words })
        return Promise.resolve('/mine/A link.md')
      },
    })
    world.phone = true
    world.shared = SHARE
    const stop = startHanded()
    expect(world.heard.has('__ordenHanded')).toBe(true)

    await vi.waitFor(() => expect(world.done).toEqual(['word']))
    expect(world.asked).toEqual([['new', 'task']])
    expect(landed).toEqual([{ root: '/mine', folder: 'assets', words: 'a link' }])
    expect(world.opened).toEqual(['/mine/A link.md'])
    stop()
    unbind()
  })
})
