import { expect, test, vi } from 'vitest'

const ops = vi.hoisted(() => ({
  followers: [] as ((op: unknown) => void)[],
  tree: new Map<string, { path: string; name: string; is_dir: boolean }>(),
  carried: new Map<string, unknown>(),
  did: [] as string[],
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    fileOps: { follow: (one: (op: unknown) => void) => void ops.followers.push(one) },
    spaces: [{ root: '/A' }, { root: '/B' }],
    entryAt: (path: string) => ops.tree.get(path) ?? ops.carried.get(path) ?? null,
    carrying: async (entries: { path: string }[], run: () => Promise<unknown>) => {
      for (const one of entries) ops.carried.set(one.path, one)
      try {
        return await run()
      } finally {
        ops.carried.clear()
      }
    },
    copyMany: (paths: string[], into: string) => {
      ops.did.push(
        `copy ${paths.join(',')} -> ${into} (${paths.every((one) => ops.carried.has(one) || ops.tree.has(one))})`,
      )
      return Promise.resolve()
    },
    moveMany: (paths: string[], into: string) => {
      ops.did.push(
        `move ${paths.join(',')} -> ${into} (${paths.every((one) => ops.carried.has(one) || ops.tree.has(one))})`,
      )
      return Promise.resolve(true)
    },
  },
}))

const { fileClipboard } = await import('./list-landing.svelte')

const tell = (op: unknown) => {
  for (const one of ops.followers) one(op)
}

test('a cut note renamed before it is pasted is pasted under its new name', () => {
  fileClipboard.hold(['/s/a.md', '/s/f/b.md'], true)
  tell({ op: 'moved', kind: 'file', from: '/s/a.md', to: '/s/c.md', root: '/s' })
  tell({ op: 'moved', kind: 'folder', from: '/s/f', to: '/s/g', root: '/s' })
  expect(fileClipboard.paths).toEqual(['/s/c.md', '/s/g/b.md'])
  expect(fileClipboard.isCut('/s/g/b.md')).toBe(true)
})

test('a held note deleted before it is pasted is let go', () => {
  fileClipboard.hold(['/s/a.md', '/s/f/b.md'], false)
  tell({ op: 'removed', kind: 'folder', path: '/s/f', root: '/s' })
  expect(fileClipboard.paths).toEqual(['/s/a.md'])
})

test('rows copied or cut in one space are pasted into another', async () => {
  ops.tree = new Map([['/A/plan.md', { path: '/A/plan.md', name: 'plan.md', is_dir: false }]])
  fileClipboard.hold(['/A/plan.md'], false)
  ops.tree = new Map()
  await fileClipboard.paste('/B')

  ops.tree = new Map([['/A/f', { path: '/A/f', name: 'f', is_dir: true }]])
  fileClipboard.hold(['/A/f'], true)
  ops.tree = new Map()
  await fileClipboard.paste('/B/in')

  expect(ops.did).toEqual(['copy /A/plan.md -> /B (true)', 'move /A/f -> /B/in (true)'])
  expect(fileClipboard.paths).toEqual([])
})
