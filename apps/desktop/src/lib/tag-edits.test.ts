import { describe, expect, test } from 'vitest'
import { tagChange, tagChanges } from './tag-edits'

const NOTE = `---
tags: [work/nib, other]
---

# Notes

A line about #work/nib and one about #work/nib/canvas.
Nothing here about #working.
`

const change = (from: string, to: string | null, body = NOTE) =>
  tagChange('/space/a.md', body, from, to)

describe('renaming a tag in one note', () => {
  test('rewrites the node and leaves what hung off it', () => {
    const made = change('work/nib', 'work/core')
    expect(made?.after).toContain('tags: [work/core, other]')
    expect(made?.after).toContain('about #work/core and one about #work/core/canvas')
  })

  test('and leaves a tag that only starts the same way', () => {
    expect(change('work/nib', 'work/core')?.after).toContain('#working')
  })

  test('reaching a whole subtree from its root', () => {
    const made = change('work', 'jobs')
    expect(made?.after).toContain('tags: [jobs/nib, other]')
    expect(made?.after).toContain('#jobs/nib/canvas')
  })

  test('as edits the size of the words that changed, not of the note', () => {
    const made = change('work/nib', 'work/core')
    expect(made?.edits).toHaveLength(3)
    for (const edit of made?.edits ?? []) expect(edit.insert).toBe('work/core')
  })

  test('with the way back, so undoing it moves no caret', () => {
    const made = change('work/nib', 'work/core')
    if (!made) throw new Error('nothing changed')

    let out = ''
    let at = 0
    for (const edit of made.back) {
      out += made.after.slice(at, edit.from) + edit.insert
      at = edit.to
    }
    expect(out + made.after.slice(at)).toBe(NOTE)
  })

  test('and nothing at all for a note that never said it', () => {
    expect(change('absent', 'present')).toBeNull()
    expect(change('work/nib', 'work/core', '# Just a heading\n')).toBeNull()
  })
})

describe('taking a tag away', () => {
  test('takes the hash and the space with it', () => {
    const made = change('work/nib', null)
    expect(made?.after).toContain('A line about and one about.')
  })

  test('and the list entry it was, leaving the others', () => {
    expect(change('work/nib', null)?.after).toContain('tags: [other]')
  })

  test('and everything under the node', () => {
    const made = change('work/nib', null)
    expect(made?.after).not.toContain('#work/nib')
    expect(made?.after).toContain('#working')
  })

  test('with the way back, which puts every one of them back', () => {
    const made = change('work/nib', null)
    if (!made) throw new Error('nothing changed')

    let out = ''
    let at = 0
    for (const edit of made.back) {
      out += made.after.slice(at, edit.from) + edit.insert
      at = edit.to
    }
    expect(out + made.after.slice(at)).toBe(NOTE)
  })
})

describe('across a space', () => {
  const notes: Record<string, string> = {
    '/space/a.md': 'about #work/nib\n',
    '/space/b.md': 'about #other\n',
    '/space/c.md': '---\ntags:\n  - work/nib/canvas\n---\n\nwords\n',
  }

  test('only the notes that said it are changed', async () => {
    const made = await tagChanges(Object.keys(notes), 'work/nib', 'work/core', (path) =>
      Promise.resolve(notes[path] ?? null),
    )

    expect(made.map((one) => one.path)).toEqual(['/space/a.md', '/space/c.md'])
    expect(made[0]?.after).toBe('about #work/core\n')
    expect(made[1]?.after).toContain('- work/core/canvas')
  })

  test('and a note that cannot be read is not one of them', async () => {
    const made = await tagChanges(['/space/gone.md'], 'work/nib', 'work/core', () =>
      Promise.resolve(null),
    )
    expect(made).toEqual([])
  })
})

describe('in a note written with CRLF endings', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n')

  test('a rename reaches the front matter and keeps the endings', () => {
    const made = change('work', 'job', crlf('---\ntags: [work, other]\n---\n\nx #work\n'))
    expect(made?.after).toBe(crlf('---\ntags: [job, other]\n---\n\nx #job\n'))
  })

  test('taking a tag away cuts it from the list on the key', () => {
    const made = change('work', null, crlf('---\ntags: [work, other]\n---\nx\n'))
    expect(made?.after).toBe(crlf('---\ntags: [other]\n---\nx\n'))
  })

  test('and an item that held nothing else goes with its whole line', () => {
    const made = change('work', null, crlf('---\ntags:\n  - work\n  - other\n---\nx\n'))
    expect(made?.after).toBe(crlf('---\ntags:\n  - other\n---\nx\n'))
  })
})

describe('next to a link to a heading', () => {
  const note = '## Setup\n\nSee [setup](#setup). Tagged #setup and **#setup**.\n'

  test('a rename leaves the link and reaches the tag in bold', () => {
    expect(change('setup', 'install', note)?.after).toBe(
      '## Setup\n\nSee [setup](#setup). Tagged #install and **#install**.\n',
    )
  })

  test('and so does taking the tag away', () => {
    const after = change('setup', null, note)?.after ?? ''
    expect(after).toContain('See [setup](#setup). Tagged and')
    expect(after.match(/#setup/g)).toHaveLength(1)
  })
})
