import { expect, test, vi } from 'vitest'

/** Rows of the file list dropped on the AI panel are chips (#416), each once, and a drop
 *  of anything else is left alone. */

const chat = vi.hoisted(() => ({ chips: [] as unknown[], focus: () => undefined }))
vi.mock('./chat.svelte', () => ({ chat }))

const { workspace } = await import('../../workspace.svelte')
const { dropRows } = await import('./drop')

const entry = (path: string, is_dir = false) => {
  const name = path.split('/').pop() ?? path
  return { name, path, is_dir, modified: 0, created: 0, children: [] }
}

function drop(paths: string[]) {
  const words: Record<string, string> = { 'text/nib-paths': JSON.stringify(paths) }
  const transfer = {
    types: paths.length ? ['text/nib-path'] : [],
    getData: (one: string) => words[one] ?? '',
  }
  const event = { dataTransfer: transfer, preventDefault: vi.fn() }
  dropRows(event as unknown as DragEvent)
  return event.preventDefault.mock.calls.length > 0
}

test('a note and a folder dropped on the panel are chips, each once', () => {
  workspace.tree = {
    ...entry('/s', true),
    children: [entry('/s/Herons.md'), entry('/s/Birds', true)],
  }

  expect(drop(['/s/Herons.md', '/s/Birds'])).toBe(true)
  drop(['/s/Herons.md'])
  expect(chat.chips).toEqual([
    { kind: 'note', id: '/s/Herons.md', label: 'Herons' },
    { kind: 'folder', id: '/s/Birds', label: 'Birds/' },
  ])
  expect(drop([])).toBe(false)
})

test('a web tab let go of on the panel is its page', () => {
  workspace.tabs = [{ id: 'w', shown: 'Svelte' }] as never
  const getData = (one: string) => (one === 'text/nib-tab' ? 'w' : '')
  dropRows({ dataTransfer: { types: [], getData }, preventDefault: vi.fn() } as never)
  expect(chat.chips).toContainEqual({ kind: 'tab', id: 'w', label: 'Svelte', word: 'tab' })
})
