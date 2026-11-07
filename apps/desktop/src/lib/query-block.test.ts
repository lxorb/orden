import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Hit } from '@orden/scan/search/match'

const asked: { query: unknown; excluded: unknown }[] = []
let answering: Hit[] = []

vi.mock('./search/space', () => ({
  searchSpace: (
    _root: string,
    query: unknown,
    _terms: string[],
    _limit: number,
    onFound: (found: { hits: Hit[]; loose: Hit[] }) => void,
    excluded: readonly string[],
  ) => {
    asked.push({ query, excluded })
    onFound({ hits: answering, loose: [] })
    return Promise.resolve()
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    activeSpace: { root: '/space' },
    leftOutOf: () => ['Archive'],
    instructionsName: () => 'AGENTS.md',
    open: () => Promise.resolve(),
    goto: null,
    toggleTaskAt: () => Promise.resolve(true),
  },
}))

const { queryRowsHtml } = await import('./query-block')

const hit = (over: Partial<Hit> = {}): Hit => ({
  path: '/space/Plan.md',
  name: 'Plan.md',
  line: 3,
  text: 'the plan itself',
  ranges: [{ from: 4, to: 8 }],
  ...over,
})

const answered = (code: string) => queryRowsHtml(code, 'Nothing found')

beforeEach(() => {
  asked.length = 0
  answering = []
})

describe('what a fence answers with', () => {
  test('is the search panel s rows, a word over each note', async () => {
    answering = [hit(), hit({ line: 9, text: 'and the plan again', ranges: [] })]

    const html = (await answered('plan')) ?? ''
    expect(html).toContain('class="orden-section"')
    expect(html).toContain('Plan<span>2</span>')
    expect(html).toContain('class="orden-row is-short"')
    expect(html).toContain('data-path="/space/Plan.md"')
    expect(html).toContain('data-line="3"')
    expect(html).toContain('<mark>plan</mark>')
  })

  test('and says so plainly when there is nothing', async () => {
    expect(await answered('plan')).toContain('Nothing found')
  })

  test('and nothing at all for a fence with no query in it', async () => {
    expect(await answered('   \n  ')).toBeNull()
    expect(asked).toHaveLength(0)
  })

  test('and reads a query written over two lines as one', async () => {
    await answered('tag:work\n-path:archive')

    expect(asked).toHaveLength(1)
    expect(JSON.stringify(asked[0]?.query)).toContain('archive')
  })

  test('and leaves out what the space leaves out', async () => {
    await answered('plan')

    expect(asked[0]?.excluded).toEqual(['Archive', 'AGENTS.md'])
  })

  test('and groups a note s lines under its name once', async () => {
    answering = [hit(), hit({ line: 4 }), hit({ path: '/space/Ink.md', name: 'Ink.md' })]

    const html = (await answered('plan')) ?? ''
    expect(html.match(/orden-section/g)).toHaveLength(2)
  })

  test('and shows only a handful of lines from any one note', async () => {
    answering = Array.from({ length: 20 }, (_one, index) => hit({ line: index }))

    const html = (await answered('plan')) ?? ''
    expect(html.match(/orden-row/g)).toHaveLength(5)
  })
})

describe('what a note says', () => {
  test('is text, never markup, in the line', async () => {
    answering = [hit({ text: 'plan <img src=x onerror=alert(1)>', ranges: [] })]

    const html = (await answered('plan')) ?? ''
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  test('and in the name over it', async () => {
    answering = [hit({ name: '<script>.md', ranges: [] })]

    const html = (await answered('plan')) ?? ''
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('and in the path a row carries, quotes and all', async () => {
    answering = [hit({ path: '/space/a"b.md', ranges: [] })]

    const html = (await answered('plan')) ?? ''
    expect(html).toContain('data-path="/space/a&quot;b.md"')
  })

  test('and inside what is marked as well', async () => {
    answering = [hit({ text: '<b>plan</b>', ranges: [{ from: 0, to: 3 }] })]

    const html = (await answered('plan')) ?? ''
    expect(html).not.toContain('<b>')
  })
})

describe('a row whose line is a task', () => {
  test('shows the words rather than the marker, and a box in front of them', async () => {
    answering = [hit({ text: '- [ ] write the plan', ranges: [] })]

    const html = (await answered('plan')) ?? ''
    expect(html).toContain('class="orden-checkbox" data-task')
    expect(html).toContain('>write the plan<')
    expect(html).not.toContain('- [ ]')
  })

  test('and a box that is ticked says so', async () => {
    answering = [hit({ text: '- [x] read the paper', ranges: [] })]

    expect((await answered('plan')) ?? '').toContain('data-line="3" checked')
  })

  test('and the emphasis moves along with the words', async () => {
    answering = [hit({ text: '- [ ] write the plan', ranges: [{ from: 16, to: 20 }] })]

    expect((await answered('plan')) ?? '').toContain('<mark>plan</mark>')
  })
})
