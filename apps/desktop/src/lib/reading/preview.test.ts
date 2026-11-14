import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'

const FIXTURE = `---
title: Everything
tags:
  - one
  - two
---

# Everything

[toc]

\`\`\`ts pipeline.ts
const ink = 'on glass'
\`\`\`

> [!tip]- Folds away
> Mind this.

| One | Two |
| --- | --- |
| 1 | 2 |

$$
e = mc^2
$$

- [ ] one
- [x] two

![[shot.png]]

![[Plan]]

See [[Plan#Why it works]] and [[ideas/Later|later]].

Text[^1].

[^1]: The note.
`

const BODIES: Record<string, string> = {
  'Notes/Today.md': FIXTURE,
  'Plan.md': '# Plan\n\nThe plan itself.\n\n## Why it works\n\nBecause.\n',
  'ideas/Later.md': '# Later\n\nSoon.\n',
}

const FILES = ['shot.png']

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''

    switch (command) {
      case 'scan_links':
        return {
          notes: Object.entries(BODIES).map(([one, content]) => scanNote(one, content)),
          files: FILES,
        }
      case 'read_note': {
        const doc = BODIES[path.slice(ROOT.length + 1)]
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        return doc
      }
      default:
        return undefined
    }
  },
}))

vi.mock('../note-images', () => ({
  notePicture: (src: string) => `asset://${src}`,
}))

const { links } = await import('../link-index.svelte')
const { startup } = await import('../startup.svelte')
const { readingHtml } = await import('./render')
await import('../modes.svelte')
const { EditorState, noteIndexExtension, renderNote } = await import('@orden/editor')

await import('../export')

void startup.shown()
await links.build(ROOT)

const PATH = `${ROOT}/Notes/Today.md`
const RELATIVE = 'Notes/Today.md'

function shown(render = true) {
  return EditorState.create({
    extensions: [
      noteIndexExtension({
        notes: [],
        files: FILES,
        path: RELATIVE,
        read: () => Promise.resolve(null),
        ...(render
          ? {
              render: (source: string, from: string | null) =>
                readingHtml(
                  { text: source, path: from === null ? null : `${ROOT}/${from}` },
                  'light',
                  true,
                ),
            }
          : {}),
      }),
    ],
  })
}

const reading = () => readingHtml({ text: FIXTURE, path: PATH }, 'light', true)

describe('the note behind a hover preview', () => {
  test('is the reading view of that note, to the character', async () => {
    const [preview, read] = await Promise.all([renderNote(FIXTURE, RELATIVE, shown()), reading()])

    expect(preview).toBe(read)
  })

  test('has every kind of block the reading view has', async () => {
    const html = await renderNote(FIXTURE, RELATIVE, shown())

    expect(html).toContain('<figure class="code"')
    expect(html).toContain('pipeline.ts')
    expect(html).toContain('hl-keyword')
    expect(html).toContain('data-callout="tip"')
    expect(html).toContain('callout-icon')
    expect(html).toContain('<summary')
    expect(html).toContain('<table>')
    expect(html).toContain('katex')
    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="task-list-item is-done"')
    expect(html).toContain('disabled')
    expect(html).toContain('src="asset://shot.png"')
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('The plan itself.')
    expect(html).not.toContain('class="properties"')
    expect(html).toContain('Everything')
    expect(html).toContain('href="Plan.md#why-it-works"')
    expect(html).toContain('<a class="wikilink" href="ideas/Later.md">later</a>')
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<h1 id="everything">')
    expect(html).toContain('<section class="footnotes">')
    expect(html).not.toContain('tags:')
  })

  test('is not the thin render the editor can do with no app around it', async () => {
    const thin = await renderNote(FIXTURE, RELATIVE, shown(false))

    expect(thin).not.toContain('hl-keyword')
    expect(thin).not.toContain('class="properties"')
    expect(thin).not.toContain('<figure class="embed">')
    expect(thin).not.toContain('<nav class="toc">')
    expect(thin).toContain('<p>[toc]</p>')
    expect(thin).not.toContain('class="wikilink"')
    expect(thin).toContain('src="shot.png"')
  })
})
