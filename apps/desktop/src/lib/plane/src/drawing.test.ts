// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'

vi.mock('../../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
    fileFor: () => null,
  },
}))
vi.mock('../../settings.svelte', () => ({ settings: { exportAppearance: 'light' } }))
vi.mock('../../pdf/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pdf/src/api')>()),
  paperPicture: (at: { file: string }) =>
    Promise.resolve(at.file === 'Reading.pdf' ? 'data:image/png;base64,UEFHRQ==' : null),
  holdPaper: () => () => undefined,
}))

const { planeSvg } = await import('./drawing')

const PLANE = JSON.stringify({
  nodes: [{ id: 'p', type: 'file', file: 'Reading.pdf', x: 0, y: 0, width: 240, height: 320 }],
  edges: [],
})

const shown = (text: string) => ({
  text,
  name: 'Board.canvas',
  path: 'Board.canvas',
  root: '/space',
  note: '/space/Board.canvas',
})

test('a plane drawn as a picture shows its PDF cards as their pages, at any size', async () => {
  const holder = document.createElement('div')
  holder.innerHTML = (await planeSvg(shown(PLANE))) ?? ''

  const picture = holder.querySelector('svg')
  expect(picture).not.toBeNull()
  expect(picture?.hasAttribute('width')).toBe(false)
  expect(picture?.hasAttribute('height')).toBe(false)
  expect(holder.querySelector('svg image')?.getAttribute('href')).toBe(
    'data:image/png;base64,UEFHRQ==',
  )
  expect(picture?.textContent).not.toContain('Reading.pdf')
})

test('an empty plane is no picture', async () => {
  expect(await planeSvg(shown('{"nodes":[],"edges":[]}'))).toBeNull()
})
