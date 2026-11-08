// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'

vi.mock('../link-index.svelte', () => ({
  links: {
    version: 1,
    index: (path: string | null) => ({ notes: [], path, read: () => Promise.resolve(null) }),
    targetOf: () => null,
    fileFor: () => null,
  },
}))
vi.mock('../settings.svelte', () => ({ settings: { exportAppearance: 'light' } }))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string) =>
    command === 'read_note'
      ? Promise.resolve(
          JSON.stringify({
            nodes: [
              { id: 'p', type: 'file', file: 'Reading.pdf', x: 0, y: 0, width: 240, height: 320 },
            ],
            edges: [],
          }),
        )
      : Promise.resolve(null),
}))
vi.mock('../pages/raster', () => ({
  paperPicture: (at: { file: string }) =>
    Promise.resolve(at.file === 'Reading.pdf' ? 'data:image/png;base64,UEFHRQ==' : null),
}))

vi.mock('../pages/paper', () => ({ holdPaper: () => () => undefined }))

vi.stubGlobal(
  'IntersectionObserver',
  function seen(told: (entries: { isIntersecting: boolean }[]) => void) {
    return {
      observe: () => queueMicrotask(() => told([{ isIntersecting: true }])),
      disconnect: () => undefined,
    }
  },
)

const { drawFile } = await import('./drawn')

test('a canvas set into a note draws its PDF cards as their pages', async () => {
  const card = document.body.appendChild(document.createElement('div'))
  card.innerHTML = '<a href="Board.canvas">Board</a>'
  drawFile(card, { kind: 'canvas', path: 'Board.canvas', root: '/space', page: null })

  await vi.waitFor(
    () => {
      expect(card.querySelector('svg')).not.toBeNull()
    },
    { timeout: 20000 },
  )
  const image = card.querySelector('svg image')
  expect(image?.getAttribute('href')).toBe('data:image/png;base64,UEFHRQ==')
  expect(card.querySelector('svg')?.textContent).not.toContain('Reading.pdf')
})
