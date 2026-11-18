import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const world = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  remote: [] as Record<string, unknown>[],
  spaces: [] as { id: string; name: string; root: string }[],
  done: [] as string[],
  reads: 0,
  away: new Map<string, string>(),
}))

vi.mock('../../accounts/src/api', () => ({
  account: {
    get spaces() {
      return world.remote
    },
  },
  api: {
    changes: (_token: string, spaceId: string) => {
      const root = spaceId === 'theirs' ? '/Orden/' : '/Orden 2/'
      const notes = [...world.away]
        .filter(([path]) => path.startsWith(root))
        .map(([path, hash]) => ({ path: path.slice(root.length), hash, deleted: false }))
      return Promise.resolve({ notes, cursor: 1, more: false })
    },
  },
}))

vi.mock('../../platform/src/tauri', () => ({
  isNative: true,
  isDesktop: true,
  platform: () => 'linux',
  joinPath: (...parts: string[]) => parts.join('/'),
  invoke: (command: string, args: { root?: string; path?: string }) => {
    if (command === 'read_tree') {
      const root = args.root ?? ''
      const children = [...new Set([...world.disk.keys(), ...world.away.keys()])]
        .filter((path) => path.startsWith(`${root}/`))
        .map((path) => ({
          name: path,
          path,
          is_dir: false,
          children: [],
          evicted: !world.disk.has(path),
        }))
      return Promise.resolve({ name: root, path: root, is_dir: true, children })
    }
    if (command === 'read_file') {
      world.reads += 1
      const text = world.disk.get(args.path ?? '')
      if (text === undefined) return Promise.reject(new Error('no such file'))
      return Promise.resolve(new TextEncoder().encode(text).buffer)
    }
    return Promise.reject(new Error(`no ${command} here`))
  },
}))

vi.mock('../../space-owed/src/api', () => ({
  endSpace: (_token: string, who: string, id: string, how: string) => {
    world.done.push(`${how} ${id} for ${who}`)
    return Promise.resolve()
  },
}))

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    get spaces() {
      return world.spaces
    },
    deleteSpace: (id: string, keep: boolean) => {
      world.done.push(`space ${id} to ${keep ? 'recently deleted' : 'nowhere'}`)
      return Promise.resolve()
    },
    bin: (path: string) => {
      world.disk.delete(path)
      world.done.push(`bin ${path}`)
      return Promise.resolve({ content: '', back: `back-${path}` })
    },
    fileGone: (path: string, kind: string, back?: string) => {
      world.done.push(`gone ${kind} ${path} ${back}`)
      return Promise.resolve()
    },
  },
}))

const { mendSharedCopies } = await import('./shared-copies')

const SHARE = { id: 'theirs', name: 'Orden', role: 'write', shared: true, createdAt: 10, notes: 2 }

function copy(id: string, name: string, more: Record<string, unknown> = {}) {
  return { id, name, role: 'owner', shared: false, createdAt: 20, notes: 2, ...more }
}

function device(pairs: { root: string; spaceId: string }[]) {
  const held = pairs.map((one) => ({ ...one, shared: false }))
  return {
    held,
    pairing: {
      pairs: () => held,
      pair: () => undefined,
      unpair: (root: string) => {
        world.done.push(`unpair ${root}`)
        held.splice(
          held.findIndex((one) => one.root === root),
          1,
        )
      },
      share: () => undefined,
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  world.disk = new Map([
    ['/Orden/Plan.md', 'the plan'],
    ['/Orden/Ideas.md', 'ideas'],
  ])
  world.spaces = [
    { id: 'o', name: 'Orden', root: '/Orden' },
    { id: 'c', name: 'Orden 2', root: '/Orden 2' },
  ]
  world.remote = [SHARE, copy('mine', 'Orden 2')]
  world.done = []
  world.reads = 0
  world.away = new Map()
})

const PAIRS = [
  { root: '/Orden', spaceId: 'theirs' },
  { root: '/Orden 2', spaceId: 'mine' },
]

describe('a copy of a shared space this device made of its own', () => {
  test('goes to recently deleted, and from the account, when it holds the same words', async () => {
    world.disk.set('/Orden 2/Plan.md', 'the plan')
    world.disk.set('/Orden 2/Ideas.md', 'ideas')
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([
      'unpair /Orden 2',
      'space c to recently deleted',
      'delete mine for u1',
    ])
  })

  test('keeps every note that differs from the shared one or is only in the copy', async () => {
    world.disk.set('/Orden 2/Plan.md', 'the plan')
    world.disk.set('/Orden 2/Ideas.md', 'ideas, and one more written in the copy')
    world.disk.set('/Orden 2/New.md', 'only here')
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([
      'bin /Orden 2/Plan.md',
      'gone file /Orden 2/Plan.md back-/Orden 2/Plan.md',
    ])
    expect(world.disk.get('/Orden 2/Ideas.md')).toBe('ideas, and one more written in the copy')
    expect(world.disk.get('/Orden 2/New.md')).toBe('only here')
    expect(world.disk.get('/Orden/Plan.md')).toBe('the plan')
  })

  test('waits until the shared space’s notes are all here too', async () => {
    world.disk.set('/Orden 2/Plan.md', 'the plan')
    world.disk.set('/Orden 2/Ideas.md', 'ideas')
    world.remote[0] = { ...SHARE, notes: 3 }
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)
    expect(world.done).toEqual([])

    world.disk.set('/Orden/Later.md', 'later')
    await mendSharedCopies('token', 'u1', pairing, PAIRS)
    expect(world.done).toContain('delete mine for u1')
  })

  test('kept away here on both sides is matched by the words the account holds', async () => {
    world.disk = new Map()
    world.away = new Map([
      ['/Orden/Plan.md', 'h-plan'],
      ['/Orden/Ideas.md', 'h-ideas'],
      ['/Orden 2/Plan.md', 'h-plan'],
      ['/Orden 2/Ideas.md', 'h-ideas, changed'],
    ])
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([
      'bin /Orden 2/Plan.md',
      'gone file /Orden 2/Plan.md back-/Orden 2/Plan.md',
    ])
  })

  test('kept away on one side only is kept', async () => {
    world.disk.set('/Orden 2/Ideas.md', 'ideas')
    world.away = new Map([['/Orden 2/Plan.md', 'h-plan']])
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([
      'bin /Orden 2/Ideas.md',
      'gone file /Orden 2/Ideas.md back-/Orden 2/Ideas.md',
    ])
  })

  test('is looked at once, so a second round changes nothing', async () => {
    world.disk.set('/Orden 2/Ideas.md', 'other words')
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)
    const reads = world.reads
    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([])
    expect(world.reads).toBe(reads)
    expect(world.disk.get('/Orden 2/Ideas.md')).toBe('other words')
  })

  test('that is empty here and on the account goes, whatever number its folder took', async () => {
    world.spaces.push({ id: 'e', name: 'Orden 3', root: '/Orden 3' })
    world.remote.push(copy('empty', 'Orden', { notes: 0 }))
    world.disk.set('/Orden 2/Ideas.md', 'changed')
    const pairs = [...PAIRS, { root: '/Orden 3', spaceId: 'empty' }]
    const { pairing } = device(pairs)

    await mendSharedCopies('token', 'u1', pairing, pairs)

    expect(world.done).toEqual([
      'unpair /Orden 3',
      'space e to recently deleted',
      'delete empty for u1',
    ])
  })

  test('waits while the account holds notes of it this device has not got yet', async () => {
    const { pairing, held } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([])
    expect(held).toHaveLength(2)

    world.disk.set('/Orden 2/Plan.md', 'the plan')
    world.disk.set('/Orden 2/Ideas.md', 'ideas')
    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([
      'unpair /Orden 2',
      'space c to recently deleted',
      'delete mine for u1',
    ])
  })
})

describe('a space of the account’s own beside a shared one', () => {
  beforeEach(() => {
    world.disk.set('/Orden 2/Plan.md', 'the plan')
    world.disk.set('/Orden 2/Ideas.md', 'ideas')
  })

  test('is left alone when it is older than the share', async () => {
    world.remote = [SHARE, copy('mine', 'Orden 2', { createdAt: 5 })]
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([])
  })

  test('is left alone when the account shares it too', async () => {
    world.remote = [SHARE, copy('mine', 'Orden 2', { shared: true })]
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([])
  })

  test('is left alone under a name of its own', async () => {
    world.spaces[1] = { id: 'c', name: 'Orden notes', root: '/Orden 2' }
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS)

    expect(world.done).toEqual([])
  })

  test('is left alone when it was only paired in this round', async () => {
    const { pairing } = device(PAIRS)

    await mendSharedCopies('token', 'u1', pairing, PAIRS.slice(0, 1))

    expect(world.done).toEqual([])
  })
})
