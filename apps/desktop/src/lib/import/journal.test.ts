import { describe, expect, test } from 'vitest'

import { readJournal } from './journal'
import { detect } from './read'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

/** One entry, in the shape Journal's own export writes: the date in a div of its
 *  own, the title in another, a card per photo, video and mood, and the words in
 *  `bodyText`. Apple writes the date in the language of the phone, which is why
 *  the file's name is what the day is read from. */
const ENTRY = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="Generator" content="Cocoa HTML Writer">
<title>Journal</title>
<style>.pageHeader { font-size: 11px } .p2 { margin: 0 }</style>
</head>
<body>
<div class="pageHeader">Friday, September 4, 2026</div>
<div class="entry">
<div class="title"><span class="s1"></span><span class="s2">Evening on the lake</span></div>
<div class="gridItem assetType_photo" id="A1B2C3D4-1111-2222-3333-444455556666">
<img src="../Resources/A1B2C3D4-1111-2222-3333-444455556666.heic" alt="">
</div>
<div class="gridItem assetType_video" id="B2C3D4E5-1111-2222-3333-444455556666">
<video controls>
<source src="../Resources/B2C3D4E5-1111-2222-3333-444455556666.mov" type="video/quicktime">
</video>
</div>
<div class="gridItem assetType_stateOfMind" id="C3D4E5F6-1111-2222-3333-444455556666">
<span class="s2">Calm</span>
</div>
<div class="bodyText">
<p class="p2"><span class="s2">Swam at seven, then sat on the jetty.</span></p>
<p class="p2"><span class="s3">The water was warmer than the air.</span></p>
</div>
</div>
</body>
</html>
`

/** A second entry the same day, with no title at all, which is what an entry
 *  somebody only wrote in looks like. */
const BARE = `<html><body>
<div class="pageHeader">Friday, September 4, 2026</div>
<div class="bodyText"><p class="p2"><span class="s2">Rained all afternoon.</span></p></div>
</body></html>
`

function anExport(): Source[] {
  return [
    file(
      'AppleJournalEntries/Index.html',
      '<html><body><a href="Entries/x.html">x</a></body></html>',
    ),
    file('AppleJournalEntries/Entries/2026-09-04_9E1C2D3E.html', ENTRY),
    file('AppleJournalEntries/Entries/2026-09-04_1F2A3B4C.html', BARE),
    file(
      'AppleJournalEntries/Resources/A1B2C3D4-1111-2222-3333-444455556666.json',
      '{"date":810172800,"placeName":"Zurichsee"}',
    ),
    sourceOf(
      'AppleJournalEntries/Resources/A1B2C3D4-1111-2222-3333-444455556666.heic',
      new Uint8Array([1, 2, 3]),
    ),
    sourceOf(
      'AppleJournalEntries/Resources/B2C3D4E5-1111-2222-3333-444455556666.mov',
      new Uint8Array([4, 5, 6]),
    ),
  ]
}

function noteAt(plan: Awaited<ReturnType<typeof readJournal>>, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  expect(found, `${path} among ${plan.files.map((one) => one.path).join(', ')}`).toBeTruthy()
  return found?.kind === 'note' ? found.text : ''
}

describe('an Apple Journal export', () => {
  test('is what it is, by the entries it holds', async () => {
    expect(await detect(anExport())).toBe('journal')
  })

  test('is not read as an HTML folder, which it also looks like', async () => {
    // The words kept and the look lost is what the HTML reader says; a Journal
    // export says more than that, so the more specific reader has to win.
    expect(await detect([anExport()[1] as Source])).toBe('journal')
  })

  test('becomes one note per entry, named after the day it was written', async () => {
    const plan = await readJournal(anExport())
    const paths = plan.files.map((one) => one.path)

    expect(paths).toContain('2026-09-04 Evening on the lake.md')
    // The second entry of the same day has no title, so the day is its name, and
    // it steps aside from nothing since the first note's name is longer.
    expect(paths).toContain('2026-09-04.md')
    expect(plan.format).toBe('journal')
  })

  test("carries the entry's day as front matter and its title as the heading", async () => {
    const plan = await readJournal(anExport())
    const note = noteAt(plan, '2026-09-04 Evening on the lake.md')

    expect(note.startsWith('---\ndate: 2026-09-04\n---\n')).toBe(true)
    expect(note).toContain('# Evening on the lake')
    // The date line and the title are not said twice: they are the two things
    // lifted out of the document before it was converted.
    expect(note).not.toContain('Friday, September 4, 2026')
    expect(note.match(/Evening on the lake/g)).toHaveLength(1)
  })

  test('keeps the words, the mood and the place the entry said', async () => {
    const note = noteAt(await readJournal(anExport()), '2026-09-04 Evening on the lake.md')

    expect(note).toContain('Swam at seven, then sat on the jetty.')
    expect(note).toContain('The water was warmer than the air.')
    expect(note).toContain('Calm')
  })

  test('brings the media beside the notes, video included', async () => {
    const plan = await readJournal(anExport())
    const paths = plan.files.map((one) => one.path)
    const note = noteAt(plan, '2026-09-04 Evening on the lake.md')

    expect(paths).toContain('assets/A1B2C3D4-1111-2222-3333-444455556666.heic')
    expect(paths).toContain('assets/B2C3D4E5-1111-2222-3333-444455556666.mov')

    // The picture comes through the HTML converter; the video does not, because
    // markdown has no player, so it is written as a link to the file instead.
    expect(note).toContain('![](assets/A1B2C3D4-1111-2222-3333-444455556666.heic)')
    expect(note).toContain('(assets/B2C3D4E5-1111-2222-3333-444455556666.mov)')
  })

  test("leaves out Journal's own index and its JSON about each file", async () => {
    const paths = (await readJournal(anExport())).files.map((one) => one.path)

    expect(paths.some((one) => one.toLowerCase().includes('index'))).toBe(false)
    expect(paths.some((one) => one.endsWith('.json'))).toBe(false)
  })

  test('says what a reader has to know: HEIC, and the cards Journal draws', async () => {
    const said = (await readJournal(anExport())).lost.map((one) => one.text)

    expect(said.some((one) => one.includes('HEIC'))).toBe(true)
    expect(said.some((one) => one.includes('mood and activity'))).toBe(true)
  })

  test('an entry with no date anywhere is still a note', async () => {
    const plan = await readJournal([
      file('Entries/whatever.html', '<html><body>Words</body></html>'),
    ])
    const note = plan.files[0]

    expect(note?.path).toBe('whatever.md')
    expect(note?.kind === 'note' && note.text).toContain('Words')
    expect(note?.kind === 'note' && note.text).not.toContain('date:')
  })
})
