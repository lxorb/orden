import { expect, test, vi } from 'vitest'

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    activeSpace: { root: '/s/Home' },
    fileOps: { follow: () => undefined },
    rootHolding: (path: string | null) => (path?.startsWith('/s/Work/') ? '/s/Work' : '/s/Home'),
  },
}))
vi.mock('../../rows/src/rows.svelte', () => ({ rows: { of: () => [] } }))
vi.mock('../../link-index.svelte', () => ({
  links: {
    targetOf: (from: string | null, link: { target: string }) =>
      link.target === 'Clients.base'
        ? from?.startsWith('/s/Work/')
          ? 'Bases/Clients.base'
          : null
        : null,
  },
}))

const { embeddedPath } = await import('./source')

test("a base embedded in a note of another space is that space's base", () => {
  expect(embeddedPath('Clients.base#Table', '/s/Work/Plan.md')).toBe('/s/Work/Bases/Clients.base')
  expect(embeddedPath('Clients.base', '/s/Home/Plan.md')).toBeNull()
})
