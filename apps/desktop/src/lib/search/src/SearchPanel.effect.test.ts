import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'
import { taskHash } from '@orden/bases'

const { search } = await import('./panel.svelte')
const { workspace } = await import('../../workspace/src/api')
const SearchPanel = (await import('./SearchPanel.svelte')).default
const PAPER = '/space/Paper.pdf'

const page = (page: number): Hit => ({
  path: PAPER,
  name: 'Paper.pdf',
  page,
  line: 0,
  text: `tulip on page ${page}`,
  ranges: [],
})

let target: HTMLElement | undefined
let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  target?.remove()
  search.found = []
  vi.restoreAllMocks()
})

function panel(): HTMLElement {
  const into = document.createElement('div')
  document.body.append(into)
  target = into
  shown = mount(SearchPanel, { target: into, props: {} })
  return into
}

describe('a paper found on more than one page', () => {
  test('shows a row for each page', () => {
    const into = panel()
    search.found = [page(1), page(2)]
    flushSync()

    const rows = [...into.querySelectorAll('.orden-row-meta')].map((row) => row.textContent)
    expect(rows).toEqual(['Page 1', 'Page 2'])
  })
})

describe('ticking a task in the results', () => {
  test('names the task it showed, so a note edited since ticks that task or none', async () => {
    const ticks = vi.spyOn(workspace, 'toggleTaskAt').mockResolvedValue(false)
    const into = panel()
    search.found = [
      { path: '/space/List.md', name: 'List.md', line: 3, text: '- [ ] buy milk', ranges: [] },
    ]
    flushSync()

    into.querySelector<HTMLInputElement>('input.orden-checkbox')?.click()
    await vi.waitFor(() => expect(ticks).toHaveBeenCalled())

    expect(ticks).toHaveBeenCalledWith('/space/List.md', 3, taskHash('buy milk'))
  })
})
