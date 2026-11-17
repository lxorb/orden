import { describe, expect, test, vi } from 'vitest'

const flowNote = '# Flow\n\n```mermaid\ngraph TD\nA-->B\n```\n'

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: (id: string, code: string) =>
      Promise.resolve({ svg: `<svg id="${id}"><text>${code}</text></svg>` }),
  },
}))

vi.mock('../../link-index/src/api', () => ({
  links: {
    spaceOf: () => null,
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target === 'Flow' ? 'Flow.md' : null,
    embedNote: (target: string) =>
      Promise.resolve(target === 'Flow' ? { text: flowNote, escapeHtml: false } : null),
  },
  notePicture: (src: string) => src,
  queryRowsHtml: () => Promise.resolve(null),
}))

vi.mock('../../workspace/src/api', () => ({ keptCoverOf: () => null }))

vi.stubGlobal('__EVEN_PLUGIN__', false)

const { readingHtml } = await import('./render')

describe('a diagram inside a note embedded in the reading view', () => {
  test('is drawn as a diagram, as it is in the note itself', async () => {
    const own = await readingHtml({ text: flowNote, path: '/space/Flow.md' }, 'light', true)
    expect(own).toContain('<figure class="diagram"')

    const html = await readingHtml(
      { text: 'Today\n\n![[Flow]]\n', path: '/space/Today.md' },
      'light',
      true,
    )
    expect(html).toContain('<figure class="embed">')
    expect(html).not.toContain('language-mermaid')
    expect(html).toContain('<figure class="diagram"')
  })
})
