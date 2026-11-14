import { afterEach, describe, expect, test, vi } from 'vitest'

const order: string[] = []
const said: { kind: string; path: string; text: string }[] = []
let alone = false

let there = false

vi.mock('../platform/src/tauri', () => ({
  isNative: false,
  invoke: (command: string) => {
    order.push(command)
    return Promise.resolve(command === 'path_exists' ? there : undefined)
  },
}))
vi.mock('../link-index.svelte', () => ({
  links: { noteSaved: (path: string) => void order.push(`index ${path}`) },
}))
vi.mock('../platform/src/windows', () => ({
  windows: {
    get alone() {
      return alone
    },
    say: (kind: string, what: { path: string; text: string }) => {
      order.push('said')
      said.push({ kind, ...what })
    },
  },
  oneWriteAt: async (path: string, run: () => Promise<unknown>) => {
    order.push(`turn ${path}`)
    const answer = await run()
    order.push(`turn over ${path}`)
    return answer
  },
}))

const { writeFile, writeIfAbsent } = await import('./write-file')

afterEach(() => {
  order.length = 0
  said.length = 0
  alone = false
  there = false
})

describe('a file written', () => {
  test('in its turn, and said within it', async () => {
    await writeFile('/s/a.md', 'words')
    expect(order).toEqual([
      'turn /s/a.md',
      'write_note',
      'said',
      'turn over /s/a.md',
      'index /s/a.md',
    ])
    expect(said).toEqual([{ kind: 'words', path: '/s/a.md', text: 'words' }])
  })

  test('says nothing to nobody', async () => {
    alone = true
    await writeFile('/s/a.md', 'words')
    expect(said).toEqual([])
    expect(order).toContain('write_note')
  })

  test('only if absent, looked for and written in one turn, and never over a note that is there', async () => {
    expect(await writeIfAbsent('/s/a.md', '')).toBe(true)
    expect(order).toEqual([
      'turn /s/a.md',
      'path_exists',
      'write_note',
      'said',
      'turn over /s/a.md',
      'index /s/a.md',
    ])
    order.length = 0
    there = true
    expect(await writeIfAbsent('/s/a.md', '')).toBe(false)
    expect(order).toEqual(['turn /s/a.md', 'path_exists', 'turn over /s/a.md'])
  })
})
