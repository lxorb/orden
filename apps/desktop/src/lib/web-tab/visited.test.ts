import { expect, test, vi } from 'vitest'

/** Storage for the test, since node has none; what the app writes is read back from
 *  here. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { visited } = await import('./visited')

test('a space that keeps its web data apart keeps its history apart', () => {
  visited.saw('nib:web-visits', 'a', 'https://ethz.ch/', 'ETH')
  visited.saw('nib:web-visits:0-work', 'b', 'https://moodle-app2.let.ethz.ch/', 'Moodle')

  expect(visited.suggest('nib:web-visits', 'moodle')).toEqual([])
  expect(visited.suggest('nib:web-visits:0-work', 'moodle').map((one) => one.url)).toEqual([
    'https://moodle-app2.let.ethz.ch/',
  ])
  expect(localStorage.getItem('nib:web-visits:0-work')).toContain('moodle-app2')
  expect(localStorage.getItem('nib:web-visits')).not.toContain('moodle-app2')
})

/** The words a row of the history under a held arrow reads. */
test("says what a page called itself, whatever the address's fragment", () => {
  visited.saw('nib:web-visits:titles', 'c', 'https://svelte.dev/docs', 'Svelte docs')

  expect(visited.titleOf('nib:web-visits:titles', 'https://svelte.dev/docs#intro')).toBe(
    'Svelte docs',
  )
  expect(visited.titleOf('nib:web-visits:titles', 'https://svelte.dev/blog')).toBe('')
})

test("folds another browser's history in, read row by row, and the same twice once", () => {
  const book = 'nib:web-visits:brought'
  visited.saw(book, 'd', 'https://ethz.ch/', 'ETH')
  const rows = [
    { url: 'https://ethz.ch/#news', title: 'ETH Zürich', visits: 9, typed: 2, last: 1 },
    { url: 'https://moodle.example.com/', title: 'Moodle', visits: 4, typed: 0, last: 5 },
    { url: 'javascript:void(0)', title: 'Tool', visits: 1, typed: 0, last: 2 },
    { url: 'https://broken.example.com/', visits: 'many' },
  ]
  visited.brought(book, rows)
  visited.brought(book, rows)

  const all = visited.all(book)
  expect(all.map((one) => one.url).sort()).toEqual([
    'https://ethz.ch/',
    'https://moodle.example.com/',
  ])
  const eth = all.find((one) => one.url === 'https://ethz.ch/')
  expect(eth).toMatchObject({ title: 'ETH', visits: 9, typed: 2 })
  expect(eth?.last).toBeGreaterThan(5)
  expect(all.find((one) => one.url === 'https://moodle.example.com/')).toMatchObject({
    title: 'Moodle',
    visits: 4,
    last: 5,
  })
})
