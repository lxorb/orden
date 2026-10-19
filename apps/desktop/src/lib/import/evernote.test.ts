import { describe, expect, test } from 'vitest'

import { readEvernote } from './evernote'
import { md5 } from './md5'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

/** Four bytes, so the hash in the fixture is the hash of something real. */
const PICTURE = Uint8Array.from([1, 2, 3, 4])
const BASE64 = 'AQIDBA=='
const HASH = md5(PICTURE)

function enex(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20260101T090000Z" application="Evernote">
${notes}
</en-export>`
}

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

const NOTE = `  <note>
    <title>Trip to Iceland</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>We flew on <b>Monday</b>.</div><div><ul><li>Warm socks</li></ul></div>
<div><en-media type="image/png" hash="${HASH}"/></div></en-note>]]></content>
    <created>20260102T120000Z</created>
    <updated>20260304T130000Z</updated>
    <tag>travel</tag>
    <tag>two words</tag>
    <resource>
      <data encoding="base64">${BASE64}</data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>glacier.png</file-name>
      </resource-attributes>
    </resource>
  </note>`

describe('an Evernote export', () => {
  test('becomes a note with its words, its dates and its tags', async () => {
    const plan = await readEvernote([file('Travel.enex', enex(NOTE))])

    const text = noteAt(plan, 'Trip to Iceland.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('updated: 2026-03-04')
    expect(text).toContain('tags: [travel, two-words]')
    expect(text).toContain('We flew on **Monday**.')
    expect(text).toContain('- Warm socks')
  })

  test('the picture in the note is the picture that was in the note', async () => {
    const plan = await readEvernote([file('Travel.enex', enex(NOTE))])

    const picture = plan.files.find((one) => one.kind === 'file')
    expect(picture?.path).toBe('assets/glacier.png')
    expect(picture?.kind === 'file' && [...picture.bytes]).toEqual([1, 2, 3, 4])
    expect(noteAt(plan, 'Trip to Iceland.md')).toContain('![](assets/glacier.png)')
  })

  test('a file that is not a picture becomes a link to the file', async () => {
    const paper = `  <note>
    <title>Paper</title>
    <content><![CDATA[<en-note><div><en-media type="application/pdf" hash="${HASH}"/></div></en-note>]]></content>
    <resource>
      <data encoding="base64">${BASE64}</data>
      <mime>application/pdf</mime>
      <resource-attributes><file-name>report.pdf</file-name></resource-attributes>
    </resource>
  </note>`

    const plan = await readEvernote([file('Work.enex', enex(paper))])

    expect(noteAt(plan, 'Paper.md')).toContain('[report.pdf](assets/report.pdf)')
  })

  test('a checkbox is a task', async () => {
    const list = `  <note>
    <title>Packing</title>
    <content><![CDATA[<en-note><div><en-todo checked="true"/>Passport</div><div><en-todo/>Socks</div></en-note>]]></content>
  </note>`

    const text = noteAt(await readEvernote([file('A.enex', enex(list))]), 'Packing.md')

    expect(text).toContain('- [x] Passport')
    expect(text).toContain('- [ ] Socks')
  })

  // Evernote draws a checklist as one checkbox per line, each in a div of its own.
  // Read as a list per line, the lines came out a blank line apart - one loose list,
  // spaced like paragraphs - where the note had been a checklist.
  test('checkboxes one under another are one checklist', async () => {
    const list = `  <note>
    <title>Packing</title>
    <content><![CDATA[<en-note><div><en-todo checked="true"/>Passport</div>
<div><en-todo/>Socks</div><div><en-todo/>Charger</div><div>After the list.</div></en-note>]]></content>
  </note>`

    const text = noteAt(await readEvernote([file('A.enex', enex(list))]), 'Packing.md')

    expect(text).toContain('- [x] Passport\n- [ ] Socks\n- [ ] Charger\n')
    expect(text).toContain('After the list.')
  })

  test('encrypted text is marked and counted rather than quietly dropped', async () => {
    const secret = `  <note>
    <title>Secret</title>
    <content><![CDATA[<en-note><div>Before</div><div><en-crypt cipher="AES">gibberish</en-crypt></div></en-note>]]></content>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(secret))])

    expect(noteAt(plan, 'Secret.md')).toContain('…')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
    expect(plan.lost[0]?.text).toContain('encrypted')
  })

  test('an attachment with no name of its own is named after its bytes', async () => {
    const unnamed = `  <note>
    <title>Shot</title>
    <content><![CDATA[<en-note><en-media type="image/jpeg" hash="${HASH}"/></en-note>]]></content>
    <resource><data encoding="base64">${BASE64}</data><mime>image/jpeg</mime></resource>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(unnamed))])

    expect(plan.files.find((one) => one.kind === 'file')?.path).toBe(
      `assets/${HASH.slice(0, 16)}.jpg`,
    )
  })

  test('two notebooks become two folders, and one becomes none', async () => {
    const several = await readEvernote([
      file('Travel.enex', enex(NOTE)),
      file('Work.enex', enex(NOTE)),
    ])

    expect(several.files.filter((one) => one.kind === 'note').map((one) => one.path)).toEqual([
      'Travel/Trip to Iceland.md',
      'Work/Trip to Iceland.md',
    ])
    // A note in a folder still points at the picture, which is a level up.
    expect(noteAt(several, 'Travel/Trip to Iceland.md')).toContain('![](../assets/glacier.png)')

    const one = await readEvernote([file('Travel.enex', enex(NOTE))])
    expect(one.files.some((file_) => file_.path === 'Trip to Iceland.md')).toBe(true)
  })

  test('two notes with one title are stepped apart', async () => {
    const twice = `${NOTE}\n${NOTE}`
    const plan = await readEvernote([file('A.enex', enex(twice))])

    const notes = plan.files.filter((one) => one.kind === 'note').map((one) => one.path)
    expect(notes).toEqual(['Trip to Iceland.md', 'Trip to Iceland 2.md'])
  })

  test('a note with no title at all still gets a name', async () => {
    const bare = `  <note>
    <content><![CDATA[<en-note><div>Some words that will do</div></en-note>]]></content>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(bare))])

    expect(plan.files[0]?.path).toBe('Some words that will do.md')
  })
})

/** A note with just this body, and whatever else goes in the note after it. */
function bodied(title: string, body: string, rest = ''): string {
  return `  <note>
    <title>${title}</title>
    <content><![CDATA[<en-note>${body}</en-note>]]></content>
${rest}
  </note>`
}

function picture(data = BASE64, name = ''): string {
  const named = name
    ? `<resource-attributes><file-name>${name}</file-name></resource-attributes>`
    : ''
  return `<resource><data encoding="base64">${data}</data><mime>image/png</mime>${named}</resource>`
}

describe('an Evernote export that is not quite what the format says', () => {
  // `atob` throws on anything that is not base64, and the throw took every note
  // in the file with it.
  test('an attachment that is not base64 is that attachment lost, not the import', async () => {
    const damaged = bodied(
      'Damaged',
      `<div>Kept</div><en-media type="image/png" hash="${HASH}"/>`,
      picture('!!not base64**'),
    )
    const plan = await readEvernote([file('A.enex', enex(`${damaged}\n${NOTE}`))])

    expect(noteAt(plan, 'Damaged.md')).toContain('Kept')
    expect(noteAt(plan, 'Trip to Iceland.md')).toContain('![](assets/glacier.png)')
    expect(plan.lost.map((one) => one.values)).toEqual([{ count: 1 }])
    expect(plan.lost[0]?.text).toContain('attachments')
  })

  // A picture whose attachment is not in the file used to vanish from the note
  // without a word.
  test('a picture whose attachment the export left out is counted', async () => {
    const plan = await readEvernote([
      file(
        'A.enex',
        enex(
          bodied('Gone', `<en-media type="image/png" hash="0123456789abcdef0123456789abcdef"/>`),
        ),
      ),
    ])

    expect(plan.lost.map((one) => one.values)).toEqual([{ count: 1 }])
  })

  test('a hash in single quotes still finds its picture', async () => {
    const plan = await readEvernote([
      file(
        'A.enex',
        enex(bodied('Quoted', `<en-media type='image/png' hash='${HASH}'/>`, picture())),
      ),
    ])

    expect(noteAt(plan, 'Quoted.md')).toContain(`![](assets/${HASH.slice(0, 16)}.png)`)
  })

  // An attachment has a `source-url` of its own, and a clipped note with no
  // address of its own took its picture's as the page it came from.
  test('the source is the note’s own, and its author comes too', async () => {
    const clipped = bodied(
      'Clipped',
      `<en-media type="image/png" hash="${HASH}"/>`,
      `<note-attributes><author>Ann Smith</author></note-attributes>
<resource><data encoding="base64">${BASE64}</data><mime>image/png</mime>
<resource-attributes><source-url>https://images.example.com/a.png</source-url></resource-attributes></resource>`,
    )

    const text = noteAt(await readEvernote([file('A.enex', enex(clipped))]), 'Clipped.md')

    expect(text).not.toContain('images.example.com')
    expect(text).toContain('author: Ann Smith')
  })

  // Every note Evernote exports says `<reminder-order>0</reminder-order>`, so
  // every import said every note had had a reminder.
  test('a reminder order of nought is no reminder', async () => {
    const none = bodied(
      'None',
      'x',
      '<note-attributes><reminder-order>0</reminder-order></note-attributes>',
    )
    const one = bodied(
      'One',
      'x',
      '<note-attributes><reminder-order>1424108700000</reminder-order><reminder-time>20150216T174500Z</reminder-time></note-attributes>',
    )

    const plan = await readEvernote([file('A.enex', enex(`${none}\n${one}`))])

    expect(plan.lost.map((found) => found.values)).toEqual([{ count: 1 }])
  })

  test('one picture in two notes is one file', async () => {
    const twice = `${bodied('One', `<en-media type="image/png" hash="${HASH}"/>`, picture(BASE64, 'p.png'))}
${bodied('Two', `<en-media type="image/png" hash="${HASH}"/>`, picture(BASE64, 'p.png'))}`

    const plan = await readEvernote([file('A.enex', enex(twice))])

    expect(plan.files.filter((one) => one.kind === 'file').map((one) => one.path)).toEqual([
      'assets/p.png',
    ])
    expect(noteAt(plan, 'Two.md')).toContain('![](assets/p.png)')
  })

  test('a file name that is a whole Windows path is named after the file', async () => {
    const plan = await readEvernote([
      file(
        'A.enex',
        enex(
          bodied(
            'Scan',
            `<en-media type="image/png" hash="${HASH}"/>`,
            picture(BASE64, 'C:\\Users\\ann\\scan.png'),
          ),
        ),
      ),
    ])

    expect(plan.files.find((one) => one.kind === 'file')?.path).toBe('assets/scan.png')
  })

  test('an attachment the body never places is linked at the end of its note', async () => {
    const loose = bodied(
      'Loose',
      '<div>Words</div>',
      `<resource><data encoding="base64">${BASE64}</data><mime>application/pdf</mime><resource-attributes><file-name>paper.pdf</file-name></resource-attributes></resource>`,
    )

    expect(noteAt(await readEvernote([file('A.enex', enex(loose))]), 'Loose.md')).toContain(
      'Words\n\n[paper.pdf](assets/paper.pdf)',
    )
  })
})

describe('the markup of an Evernote note', () => {
  async function body(enml: string): Promise<string> {
    const plan = await readEvernote([file('A.enex', enex(bodied('Note', enml)))])
    return noteAt(plan, 'Note.md')
      .replace(/^# Note\n\n/, '')
      .trimEnd()
  }

  // ENML is XML, where `<div/>` is empty; as HTML it opens a div that never
  // closes, and a clipped page with thousands of them overflowed the stack.
  test('an empty div written the XML way holds nothing', async () => {
    expect(await body('<div/>first<div/>second')).toBe('first\n\nsecond')
    expect(await body(`${'<div/>'.repeat(4000)}<div>end</div>`)).toBe('end')
  })

  test('a less-than sign in the words stays in the words', async () => {
    expect(await body('<div>if a &lt;b&gt; c</div>')).toContain('if a \\<b> c')
  })

  // The current Evernote writes a checklist as a list marked `--en-todo`, with
  // a list inside it beside the item it belongs to rather than inside it.
  test('a checklist the current Evernote wrote keeps its boxes and its nesting', async () => {
    const list =
      '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Pack</div></li>' +
      '<ul style="--en-todo:true;"><li style="--en-checked:false;"><div>Socks</div></li></ul>' +
      '<li style="--en-checked:false;"><div>Leave<br/></div></li></ul>'

    expect(await body(list)).toBe('- [x] Pack\n  - [ ] Socks\n- [ ] Leave')
  })

  test('a list inside a list is nested and numbered as drawn', async () => {
    const list =
      '<ol><li><div>One</div></li><ol><li><div>Inner</div></li></ol><li><div>Two</div></li></ol>'

    expect(await body(list)).toBe('1. One\n   1. Inner\n2. Two')
  })

  test('a checkbox at the start of a list item is that item’s box', async () => {
    const list =
      '<ul><li><b><en-todo checked="true"/></b>Done</li><li><en-todo></en-todo>Open</li></ul>'

    expect(await body(list)).toBe('- [x] Done\n- [ ] Open')
  })

  test('a break at the end of a checkbox line does not loosen the list', async () => {
    expect(await body('<div><en-todo/>One<br/></div><div><en-todo/>Two</div>')).toBe(
      '- [ ] One\n- [ ] Two',
    )
  })

  test('a code block is code, a line per div', async () => {
    const code =
      '<div style="box-sizing: border-box;-en-codeblock:true;"><div>if (a &lt; b) {</div>' +
      '<div>&nbsp;&nbsp;*x* = 1<br/></div><div><br/></div><div>}</div></div><div>After</div>'

    expect(await body(code)).toBe('```\nif (a < b) {\n  *x* = 1\n\n}\n```\n\nAfter')
  })

  test('an encrypted passage in a sentence leaves the sentence whole', async () => {
    expect(await body('<div>Before <en-crypt cipher="AES">abc</en-crypt> after</div>')).toBe(
      'Before … after',
    )
  })
})
