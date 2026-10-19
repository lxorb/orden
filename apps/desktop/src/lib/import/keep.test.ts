import { describe, expect, test } from 'vitest'

import { readKeep } from './keep'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

function keepNote(note: Record<string, unknown>): string {
  return JSON.stringify(note)
}

describe('a Google Keep export', () => {
  test('becomes a note with its labels as tags and its dates', async () => {
    const plan = await readKeep([
      file(
        'Takeout/Keep/Shopping.json',
        keepNote({
          title: 'Shopping',
          textContent: 'Bread and milk',
          labels: [{ name: 'Home' }, { name: 'to do' }],
          createdTimestampUsec: 1767355200000000,
          userEditedTimestampUsec: 1769947200000000,
          color: 'DEFAULT',
        }),
      ),
    ])

    const text = noteAt(plan, 'Shopping.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('tags: [Home, to-do]')
    expect(text).toContain('Bread and milk')
  })

  test('a list is a task list, in the state it was left in', async () => {
    const plan = await readKeep([
      file(
        'Keep/List.json',
        keepNote({
          title: 'Packing',
          listContent: [
            { text: 'Passport', isChecked: true },
            { text: 'Socks', isChecked: false },
          ],
        }),
      ),
    ])

    const text = noteAt(plan, 'Packing.md')
    expect(text).toContain('- [x] Passport')
    expect(text).toContain('- [ ] Socks')
  })

  test('a picture beside the note comes with it', async () => {
    const plan = await readKeep([
      file('Keep/Shot.json', keepNote({ title: 'Shot', attachments: [{ filePath: 'shot.jpeg' }] })),
      file('Keep/shot.jpeg', 'JPEG'),
    ])

    expect(plan.files.some((one) => one.path === 'assets/shot.jpeg')).toBe(true)
    expect(noteAt(plan, 'Shot.md')).toContain('![](assets/shot.jpeg)')
  })

  test('what was in the bin stays there, and is counted', async () => {
    const plan = await readKeep([
      file('Keep/Gone.json', keepNote({ title: 'Gone', textContent: 'x', isTrashed: true })),
      file('Keep/Here.json', keepNote({ title: 'Here', textContent: 'y' })),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Here.md'])
    expect(plan.lost[0]?.text).toContain('bin')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
  })

  test('an archived note goes to a folder called Archive, and says so', async () => {
    const plan = await readKeep([
      file('Keep/Old.json', keepNote({ title: 'Old', textContent: 'x', isArchived: true })),
    ])

    expect(plan.files[0]?.path).toBe('Archive/Old.md')
    expect(plan.lost.some((one) => one.text.includes('Archive'))).toBe(true)
  })

  test('a colour is mentioned rather than kept', async () => {
    const plan = await readKeep([
      file('Keep/A.json', keepNote({ title: 'A', textContent: 'x', color: 'TEAL' })),
    ])

    expect(plan.lost.some((one) => one.text.includes('colours'))).toBe(true)
  })

  test('a note with no title is named after what it says', async () => {
    const plan = await readKeep([
      file('Keep/1600000.json', keepNote({ textContent: 'Ring the dentist' })),
    ])

    expect(plan.files[0]?.path).toBe('Ring the dentist.md')
  })

  test("Takeout's own JSON files are not notes", async () => {
    const plan = await readKeep([
      file('Takeout/archive_browser.html', '<html></html>'),
      file('Takeout/Keep/Labels.txt', 'Home\nWork'),
      file('Takeout/settings.json', '{"version":2}'),
    ])

    expect(plan.files).toHaveLength(0)
  })
})

describe('what a real Takeout does', () => {
  test('a list with no title is named after its first item, not its box', async () => {
    const plan = await readKeep([
      file(
        'Keep/1629964242424.json',
        keepNote({ title: '', listContent: [{ text: 'Milk', isChecked: false }] }),
      ),
    ])

    expect(plan.files[0]?.path).toBe('Milk.md')
  })

  test('a note that is only a picture is not named after the picture', async () => {
    const plan = await readKeep([
      file('Keep/Shot.json', keepNote({ title: '', attachments: [{ filePath: 'a.png' }] })),
      file('Keep/a.png', 'PNG'),
    ])

    expect(plan.files.map((one) => one.path)).toContain('Untitled.md')
  })

  test('a picture the JSON calls .jpeg is found as the .jpg Takeout wrote', async () => {
    const plan = await readKeep([
      file(
        'Takeout/Keep/good place.json',
        keepNote({
          title: 'good place',
          attachments: [{ filePath: '1629964333125.746683646.jpeg' }],
        }),
      ),
      file('Takeout/Keep/1629964333125.746683646.jpg', 'JPEG'),
    ])

    expect(plan.files.map((one) => one.path)).toContain('assets/1629964333125.746683646.jpg')
    expect(noteAt(plan, 'good place.md')).toContain('![](assets/1629964333125.746683646.jpg)')
    expect(plan.lost).toEqual([])
  })

  test('an attachment that is not in the export is counted rather than dropped quietly', async () => {
    const plan = await readKeep([
      file('Keep/Voice.json', keepNote({ title: 'Voice', attachments: [{ filePath: 'a.3gp' }] })),
    ])

    expect(plan.lost.find((one) => one.text.includes('missing'))?.values).toEqual({ count: 1 })
  })

  test('a note cut short is counted, while Takeout’s own JSON is not', async () => {
    const plan = await readKeep([
      file('Takeout/Keep/Cut.json', '{"title": "Cut sh'),
      file('Takeout/Keep/settings.json', '{"version":2}'),
      file('Takeout/Keep/Here.json', keepNote({ title: 'Here', textContent: 'line 1\r\nline 2' })),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Here.md'])
    expect(plan.lost.find((one) => one.text.includes('could not be read'))?.values).toEqual({
      count: 1,
    })
    expect(noteAt(plan, 'Here.md')).toContain('line 1\nline 2')
  })

  test('a picture two notes share is written once', async () => {
    const plan = await readKeep([
      file('Keep/A.json', keepNote({ title: 'A', attachments: [{ filePath: 'p.jpg' }] })),
      file('Keep/B.json', keepNote({ title: 'B', attachments: [{ filePath: 'p.jpg' }] })),
      file('Keep/p.jpg', 'JPEG'),
    ])

    expect(plan.files.filter((one) => one.kind === 'file')).toHaveLength(1)
    expect(noteAt(plan, 'B.md')).toContain('![](assets/p.jpg)')
  })

  test('a file name a link cannot hold as written is encoded', async () => {
    const plan = await readKeep([
      file('Keep/A.json', keepNote({ title: 'A', attachments: [{ filePath: 'Shot (1).png' }] })),
      file('Keep/Shot (1).png', 'PNG'),
    ])

    expect(noteAt(plan, 'A.md')).toContain('![](assets/Shot%20%281%29.png)')
  })

  test('a page shared into a note comes as a link, and one the words hold is not repeated', async () => {
    const plan = await readKeep([
      file(
        'Keep/Links.json',
        keepNote({
          title: 'Links',
          textContent: 'See https://example.com/a',
          annotations: [
            { source: 'WEBLINK', title: 'A', url: 'https://example.com/a' },
            { source: 'WEBLINK', title: 'Cloudflare [CDN]', url: 'https://www.cloudflare.com/' },
            { source: 'WEBLINK', title: 'No address' },
          ],
        }),
      ),
    ])

    const text = noteAt(plan, 'Links.md')
    expect(text).toContain('- [Cloudflare \\[CDN\\]](<https://www.cloudflare.com/>)')
    expect(text.match(/example\.com\/a/g)).toHaveLength(1)
  })
})
