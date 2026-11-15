import { expect, test, vi } from 'vitest'

const ops = vi.hoisted(() => ({ followers: [] as ((op: unknown) => void)[] }))

vi.mock('./workspace.svelte', () => ({
  workspace: { fileOps: { follow: (one: (op: unknown) => void) => void ops.followers.push(one) } },
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
