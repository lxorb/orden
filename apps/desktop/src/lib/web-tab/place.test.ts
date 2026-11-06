import { beforeEach, expect, test, vi } from 'vitest'

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

const { placeOf, placeKept } = await import('./place')

beforeEach(() => {
  localStorage.clear()
})

test('a note that was never open has no place', () => {
  expect(placeOf('/Notes/Svelte docs.url')).toBe(null)
  expect(placeOf(null)).toBe(null)
})

test('keeps the page, the offset and the trail against the note', () => {
  placeKept('/Notes/Svelte docs.url', {
    url: 'https://svelte.dev/docs/svelte/what-are-runes',
    x: 0,
    y: 1840,
    trail: ['https://svelte.dev/docs', 'https://svelte.dev/docs/svelte/what-are-runes'],
    at: 1,
  })

  const said = placeOf('/Notes/Svelte docs.url')
  expect(said?.url).toBe('https://svelte.dev/docs/svelte/what-are-runes')
  expect(said?.y).toBe(1840)
  expect(said?.at).toBe(1)
  expect(said?.trail).toEqual([
    'https://svelte.dev/docs',
    'https://svelte.dev/docs/svelte/what-are-runes',
  ])
})

test('a note written twice keeps what was written last', () => {
  placeKept('/a.url', { url: 'https://a.example/', x: 0, y: 10 })
  placeKept('/a.url', { url: 'https://a.example/two', x: 0, y: 20 })

  expect(placeOf('/a.url')?.url).toBe('https://a.example/two')
  expect(placeOf('/a.url')?.y).toBe(20)
})

test('keeps two hundred notes and forgets the oldest', () => {
  for (let index = 0; index < 205; index += 1) {
    placeKept(`/note-${index}.url`, { url: `https://a.example/${index}`, x: 0, y: index })
  }

  expect(placeOf('/note-0.url')).toBe(null)
  expect(placeOf('/note-4.url')).toBe(null)
  expect(placeOf('/note-5.url')?.y).toBe(5)
  expect(placeOf('/note-204.url')?.y).toBe(204)
})

test('reads nothing out of nonsense', () => {
  localStorage.setItem(
    'nib:web-places',
    JSON.stringify({
      '/good.url': { url: 'https://a.example/', x: 0, y: 4 },
      '/no-url.url': { x: 0, y: 4 },
      '/no-offset.url': { url: 'https://a.example/' },
      '/a-string.url': 'https://a.example/',
      '/trail-of-numbers.url': { url: 'https://a.example/', x: 0, y: 4, trail: [1, 2] },
    }),
  )

  expect(placeOf('/good.url')?.y).toBe(4)
  expect(placeOf('/no-url.url')).toBe(null)
  expect(placeOf('/no-offset.url')).toBe(null)
  expect(placeOf('/a-string.url')).toBe(null)
  expect(placeOf('/trail-of-numbers.url')?.trail).toBe(undefined)
})
