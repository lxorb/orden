import { describe, expect, test, vi } from 'vitest'
import '@orden/markdown/eager'

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: (id: string, code: string) => Promise.resolve({ svg: `<svg id="${id}"><text>${code}</text></svg>` }),
  },
}))

const { renderNote } = await import('./render')

const flow = '# Flow\n\n```mermaid\ngraph TD\nA-->B\n```\n'
const snippet = '# Snippet\n\n```ts\nlet x = 1\n```\n'

const readNote = (target: string) => Promise.resolve(target === 'Flow' ? flow : target === 'Snippet' ? snippet : null)

describe('fences inside a note embedded in an exported document', () => {
  test('a diagram is drawn, as it is in the note itself and in the reading view', async () => {
    const own = await renderNote(flow, 'Flow.md')
    expect(own).toContain('<figure class="diagram"')

    const html = await renderNote('Today\n\n![[Flow]]\n', 'Today.md', { readNote })
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('<figure class="diagram"')
  })

  test('code is coloured, as it is in the note itself', async () => {
    const own = await renderNote(snippet, 'Snippet.md')
    expect(own).toContain('<span class="hl-keyword">let</span>')

    const html = await renderNote('Today\n\n![[Snippet]]\n', 'Today.md', { readNote })
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('<span class="hl-keyword">let</span>')
  })
})
