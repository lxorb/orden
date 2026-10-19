import { describe, expect, test } from 'vitest'

import { bearTags, bearWords, readBear } from './bear'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

describe("Bear's closed tags", () => {
  test('become tags nib can hold', () => {
    expect(bearTags('#two words# and #work#')).toBe('#two-words and #work')
    expect(bearTags('a line\n#home/kitchen#')).toBe('a line\n#home/kitchen')
  })

  test('are left alone where they are not tags', () => {
    // A hash in the middle of a word, and a pair around nothing nameable.
    expect(bearTags('a#b#c')).toBe('a#b#c')
    expect(bearTags('#  #')).toBe('#  #')
  })

  test('are left alone inside a fence, where a hash is code', () => {
    const code = ['before #a tag#', '```c', '#include <stdio.h>', '#define X 1', '```', '#after#']

    expect(bearTags(code.join('\n')).split('\n')).toEqual([
      'before #a-tag',
      '```c',
      '#include <stdio.h>',
      '#define X 1',
      '```',
      '#after',
    ])
  })

  test('an open tag is already a tag and is not touched', () => {
    expect(bearTags('#work and nothing else')).toBe('#work and nothing else')
  })
})

describe("Bear's other spellings", () => {
  test('an underline is one, rather than the lowered text nib reads a tilde as', () => {
    expect(bearWords('~under~ and ~~struck~~ and `~/path~`')).toBe(
      '<u>under</u> and ~~struck~~ and `~/path~`',
    )
    // The tildes in an address are the address.
    expect(bearWords('https://example.com/~me/~notes')).toBe('https://example.com/~me/~notes')
  })

  test("Bear 1's highlight is nib's, and a name with colons in it is not one", () => {
    expect(bearWords('::marked:: in std::vector::size')).toBe('==marked== in std::vector::size')
  })
})

/** A backup's bundle: its words, and the `info.json` Bear writes beside them. */
function bundle(name: string, text: string, bear: Record<string, unknown>): Source[] {
  const info = JSON.stringify({
    creatorIdentifier: 'net.shinyfrog.bear',
    'net.shinyfrog.bear': bear,
  })
  return [
    file(`Bear Notes 2026-08-12 at 09.54.bear2bk/${name}.textbundle/text.md`, text),
    file(`Bear Notes 2026-08-12 at 09.54.bear2bk/${name}.textbundle/info.json`, info),
  ]
}

describe('a Bear backup', () => {
  test('comes out of the folder it unzips to, without the lists Bear keeps of itself', async () => {
    const plan = await readBear([
      ...bundle('Trip', '# Trip\n', { uniqueIdentifier: 'T-1' }),
      file('Bear Notes 2026-08-12 at 09.54.bear2bk/tags.json', '{"tags":[]}'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Trip.md'])
  })

  test('carries the two days Bear knew', async () => {
    const plan = await readBear(
      bundle('Trip', '# Trip\n', {
        creationDate: '2023-10-11T08:07:06Z',
        modificationDate: '2024-01-02T09:00:00Z',
      }),
    )

    expect(textOf(plan, 'Trip.md')).toBe(
      '---\ndate: 2023-10-11\nupdated: 2024-01-02\n---\n\n# Trip\n',
    )
  })

  test('leaves the bin and the locked notes behind and says so, and archives the archived', async () => {
    const plan = await readBear([
      ...bundle('Kept', '# Kept\n', {}),
      ...bundle('Thrown', '# Thrown\n', { trashed: 1 }),
      ...bundle('Secret', '', { encrypted: 1, encryptedData: 'AAEB' }),
      ...bundle('Old', '# Old\n', { archived: 1 }),
    ])

    expect(plan.files.map((one) => one.path).sort()).toEqual(['Archive/Old.md', 'Kept.md'])
    expect(plan.lost.map((one) => [one.text, one.values])).toEqual([
      ['{count} notes were in the bin and stay there', { count: 1 }],
      ['{count} notes are behind a password, which nothing but Bear can open', { count: 1 }],
      ['{count} archived notes are in a folder called Archive', { count: 1 }],
    ])
  })

  test('a link into Bear that names a note in the backup is a link to that note', async () => {
    const plan = await readBear([
      ...bundle(
        'Trip',
        '# Trip\n[the kit](bear://x-callback-url/open-note?id=K-1)\n[by title](bear://x-callback-url/open-note?title=Packing%20list)\n[elsewhere](bear://x-callback-url/open-note?id=GONE)\n',
        {},
      ),
      ...bundle('Packing list', '# Packing list\n', { uniqueIdentifier: 'K-1' }),
    ])

    const text = textOf(plan, 'Trip.md')
    expect(text).toContain('[[Packing list|the kit]]')
    expect(text).toContain('[[Packing list|by title]]')
    expect(text).toContain('[elsewhere](bear://x-callback-url/open-note?id=GONE)')
  })

  test("a link to a heading, which Bear writes with a slash, is nib's link to that heading", async () => {
    const plan = await readBear([
      file(
        'Welcome.md',
        '# Welcome\n[[Guide/Step one|Start here]] [[Guide/Step two]] [[Trips/Iceland]]\n',
      ),
      file('Guide.md', '# Guide\n## Step one\n## Step two\n'),
      // A note in a folder is still a note in a folder.
      file('Trips/Iceland.md', '# Iceland\n'),
      file('Trips.md', '# Trips\n'),
    ])

    expect(textOf(plan, 'Welcome.md')).toContain(
      '[[Guide#Step one|Start here]] [[Guide#Step two]] [[Iceland]]',
    )
  })

  test('an info.json that does not read is a note like any other', async () => {
    const plan = await readBear([
      file('Trip.textbundle/text.md', '# Trip\n'),
      file('Trip.textbundle/info.json', '{not json'),
      file('Kit.textbundle/text.md', '# Kit\n'),
      file('Kit.textbundle/info.json', '{"net.shinyfrog.bear": null}'),
    ])

    expect(plan.files.map((one) => one.path).sort()).toEqual(['Kit.md', 'Trip.md'])
    expect(plan.lost).toEqual([])
  })
})

function textOf(plan: Awaited<ReturnType<typeof readBear>>, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  return found?.kind === 'note' ? found.text : ''
}

describe('a Bear export', () => {
  test('is a folder of notes with its tags rewritten', async () => {
    const plan = await readBear([
      file('Trip.md', '# Trip\n\n#travel notes# and [[Kit]]\n'),
      file('Kit.md', '# Kit\n'),
    ])

    expect(plan.format).toBe('bear')
    const note = plan.files.find((one) => one.path === 'Trip.md')
    expect(note?.kind === 'note' && note.text).toContain('#travel-notes')
    expect(note?.kind === 'note' && note.text).toContain('[[Kit]]')
  })

  test('leaves hidden files behind, as a folder of notes does', async () => {
    const plan = await readBear([
      file('Trip.md', '# Trip\n\n#travel notes#\n'),
      file('.git/config', '[core]\n'),
      file('.gitignore', '.obsidian/\n'),
      file('.trash/Old draft.md', '# Thrown away\n'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Trip.md'])
  })
})
