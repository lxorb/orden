import { posix } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const planNote = '# Plan\n\n![](../assets/shot.png)\n'

vi.mock('../../link-index/src/api', () => ({
  links: {
    spaceOf: () => null,
    targetOf: (_from: string | null, link: { target: string }) =>
      link.target === 'Plan' ? 'Projects/Plan.md' : null,
    embedNote: (target: string) =>
      Promise.resolve(
        target === 'Plan'
          ? { text: planNote, escapeHtml: false, path: '/space/Projects/Plan.md' }
          : null,
      ),
  },
  notePicture: (src: string, notePath: string | null) =>
    notePath === null ? src : posix.join(posix.dirname(notePath), decodeURIComponent(src)),
  queryRowsHtml: () => Promise.resolve(null),
}))

vi.mock('../../workspace/src/api', () => ({ keptCoverOf: () => null }))

vi.stubGlobal('__EVEN_PLUGIN__', false)

const { readingHtml } = await import('./render')

describe('a picture inside a note embedded from another folder', () => {
  test('is found where the embedded note keeps it, as it is in the note itself', async () => {
    const own = await readingHtml(
      { text: planNote, path: '/space/Projects/Plan.md' },
      'light',
      true,
    )
    expect(own).toContain('src="/space/assets/shot.png"')

    const html = await readingHtml(
      { text: 'Today\n\n![[Plan]]\n', path: '/space/Today.md' },
      'light',
      true,
    )
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('src="/space/assets/shot.png"')
  })
})
