import { describe, expect, test, vi } from 'vitest'

/** The note behind a hover preview, and the note inside an `![[embed]]`, read
 *  through the editor exactly as the app wires it - against the reading view of
 *  the same note, rendered here beside it.
 *
 *  What went wrong: the editor rendered a shown note itself, with a renderer that
 *  has no fence highlighter, no diagram drawers, no embed resolver, no link
 *  resolver, no metadata rows and no picture resolver for the note it was showing.
 *  So a fenced code block in a hover preview came out grey and frameless, a
 *  callout as a plain quote, a picture as a broken image - while the reading view
 *  of that very note showed all of it. There is one render now, and the whole of
 *  what this file says is that the two paths end in the same string. */

const NOTES = [
  { path: 'Plan.md', name: 'Plan', headings: ['Why it works'], blocks: [], aliases: [] },
  { path: 'ideas/Later.md', name: 'Later', headings: [], blocks: [], aliases: [] },
]

vi.mock('../link-index.svelte', () => ({
  links: {
    index: (path: string | null) => ({ notes: NOTES, path, read: () => Promise.resolve(null) }),
    embedSource: (target: string) =>
      Promise.resolve(target === 'Plan' ? '## Why it works\n\nBecause.\n' : null),
  },
}))

/** Where a picture ends up is note-images.ts's business; here it only matters
 *  that a shown note's pictures go through it at all - they used to go through
 *  the open note's resolver, which is a different note's folder. */
vi.mock('../note-images', () => ({
  notePicture: (src: string) => `asset://${src}`,
}))

const { readingHtml } = await import('./render')
const { EditorState, noteIndexExtension, renderNote } = await import('@nib/editor')

/** The exporter, loaded once rather than by whichever test rendered first; see
 *  render.test.ts, and docs/conventions.md. */
await import('../export')

/** Every kind of block a note is made of, in one note. */
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

/** The note's path as the app holds it, and as a link speaks of it. */
const PATH = '/space/Notes/Today.md'
const RELATIVE = 'Notes/Today.md'

/** The state the editor renders a shown note in, with the render the app hands
 *  over: one call to the reading view, on the shown note's own path. This is
 *  `shownHtml` in link-index.svelte.ts, which turns the relative path a link
 *  speaks in into the path the app holds. */
function shown(render = true) {
  return EditorState.create({
    extensions: [
      noteIndexExtension({
        notes: NOTES,
        files: ['shot.png'],
        path: RELATIVE,
        read: () => Promise.resolve(null),
        ...(render
          ? { render: (source: string) => readingHtml({ text: source, path: PATH }, 'light', true) }
          : {}),
      }),
    ],
  })
}

const reading = () => readingHtml({ text: FIXTURE, path: PATH }, 'light', true)

describe('the note behind a hover preview', () => {
  test('is the reading view of that note, to the character', async () => {
    const [preview, read] = await Promise.all([renderNote(FIXTURE, RELATIVE, shown()), reading()])

    // Nothing between them but the card the preview puts it in.
    expect(preview).toBe(read)
  })

  test('has every kind of block the reading view has', async () => {
    const html = await renderNote(FIXTURE, RELATIVE, shown())

    // A fence with a language and a caption: framed, captioned and coloured.
    expect(html).toContain('<figure class="code"')
    expect(html).toContain('pipeline.ts')
    expect(html).toContain('hl-keyword')
    // A callout that folds, with its icon.
    expect(html).toContain('data-callout="tip"')
    expect(html).toContain('callout-icon')
    expect(html).toContain('<summary')
    expect(html).toContain('<table>')
    expect(html).toContain('katex')
    // Task boxes, and inert - a glance is not a place a note is changed.
    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="task-list-item is-done"')
    expect(html).toContain('disabled')
    // A picture named by an embed, pointed where the host says it lives.
    expect(html).toContain('src="asset://shot.png"')
    // A note named by an embed, read out of the space.
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('Because.')
    // The note's own metadata, as the rows the editor draws.
    expect(html).toContain('class="properties"')
    expect(html).toContain('Everything')
    // Links into the space, the heading a link names, and the contents.
    expect(html).toContain('href="Plan.md#why-it-works"')
    expect(html).toContain('<a class="wikilink" href="ideas/Later.md">later</a>')
    expect(html).toContain('<nav class="toc">')
    // Anchors on the headings, and the footnotes gathered at the end.
    expect(html).toContain('<h1 id="everything">')
    expect(html).toContain('<section class="footnotes">')
    // And nothing of the front matter left in the words.
    expect(html).not.toContain('tags:')
  })

  test('is not the thin render the editor can do with no app around it', async () => {
    const thin = await renderNote(FIXTURE, RELATIVE, shown(false))

    // Each of these is one of the things missing from the preview, and each of
    // them is what a renderer with no app around it cannot produce: no parser to
    // colour a fence, no space to read an embedded note out of or to point a link
    // into, no host to ask where a picture lives, and no rows because metadata is
    // a thing the app knows a note by. The frame and the caption round the fence
    // are the renderer's own and are there either way.
    expect(thin).not.toContain('hl-keyword')
    expect(thin).not.toContain('class="properties"')
    expect(thin).not.toContain('<figure class="embed">')
    expect(thin).not.toContain('<nav class="toc">')
    expect(thin).toContain('<p>[toc]</p>')
    expect(thin).not.toContain('class="wikilink"')
    expect(thin).toContain('src="shot.png"')
  })
})
