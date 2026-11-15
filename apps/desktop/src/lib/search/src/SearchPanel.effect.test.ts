import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const { search } = await import('./panel.svelte')
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
})

describe('a paper found on more than one page', () => {
  test('shows a row for each page', () => {
    target = document.createElement('div')
    document.body.append(target)
    shown = mount(SearchPanel, { target, props: {} })
    search.found = [page(1), page(2)]
    flushSync()

    const rows = [...target.querySelectorAll('.orden-row-meta')].map((row) => row.textContent)
    expect(rows).toEqual(['Page 1', 'Page 2'])
  })
})
