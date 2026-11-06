import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { extensionOf, nameFault, nameToCommit, nameToWrite } from './naming'

const beside = (...taken: string[]) => taken

describe('a name that cannot be written', () => {
  const naming = { extension: '.md', taken: beside() }

  test('is nothing at all, which is a field nobody has finished rather than a mistake', () => {
    expect(nameFault({ ...naming, typed: '' })).toBe('empty')
    expect(nameFault({ ...naming, typed: '   ' })).toBe('empty')
  })

  test('or holds a separator, which would name another folder', () => {
    expect(nameFault({ ...naming, typed: 'Work/Plan' })).toBe('separator')
    expect(nameFault({ ...naming, typed: 'Work\\Plan' })).toBe('separator')
  })

  test('or holds one of the characters Windows keeps', () => {
    for (const typed of ['Q1: costs', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b']) {
      expect(nameFault({ ...naming, typed }), typed).toBe('illegal')
    }
  })

  test('or a control code, which no platform takes', () => {
    expect(nameFault({ ...naming, typed: `Pl${String.fromCharCode(9)}an` })).toBe('illegal')
  })

  test('or ends with a dot', () => {
    expect(nameFault({ ...naming, typed: 'Plan.' })).toBe('trailing')
  })

  test('though a space on the end is only a space on the end', () => {
    expect(nameFault({ ...naming, typed: 'Plan ' })).toBeNull()
    expect(nameToWrite('Plan ', '.md')).toBe('Plan.md')
  })

  test('or names a device, whatever the extension and whatever the case', () => {
    expect(nameFault({ ...naming, typed: 'NUL' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'nul' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'com4' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'NUL.old' })).toBe('reserved')
    expect(nameFault({ ...naming, typed: 'CON .md' })).toBe('reserved')
    for (const typed of ['COM¹', 'lpt².md', 'COM0', 'LPT0', 'CONIN$', 'conout$']) {
      expect(nameFault({ ...naming, typed }), typed).toBe('reserved')
    }
    expect(nameFault({ ...naming, typed: 'Console' })).toBeNull()
  })
})

describe('a name already in the folder', () => {
  test('is taken, judged as the name that would be written', () => {
    const taken = beside('Plan.md', 'Work')
    expect(nameFault({ typed: 'Plan', extension: '.md', taken })).toBe('taken')
    expect(nameFault({ typed: 'Notes', extension: '.md', taken })).toBeNull()
  })

  test('whatever the case it is written in', () => {
    expect(nameFault({ typed: 'plan', extension: '.md', taken: beside('Plan.md') })).toBe('taken')
  })

  test('however its letters are composed', () => {
    const taken = beside('U\u0308bersicht.md')
    expect(nameFault({ typed: 'Übersicht', extension: '.md', taken })).toBe('taken')
  })

  test('and so is a name a page note and its paper would share', () => {
    expect(
      nameFault({ typed: 'Lecture.pages', extension: '.pdf', taken: beside('Lecture.pages') }),
    ).toBe('taken')
    expect(
      nameFault({ typed: 'lecture.pages.pdf', extension: '.pdf', taken: beside('Lecture.pages') }),
    ).toBe('taken')
    expect(
      nameFault({ typed: 'Report', extension: '.pages', taken: beside('Report.pages.pdf') }),
    ).toBe('taken')
    expect(
      nameFault({ typed: 'Lecture', extension: '.pdf', taken: beside('Lecture.pages') }),
    ).toBeNull()
    expect(
      nameFault({ typed: 'Report', extension: '.md', taken: beside('Report.pages.pdf') }),
    ).toBeNull()
  })

  test('but a folder of the same name is not, because a note may sit beside one', () => {
    expect(nameFault({ typed: 'A', extension: '.md', taken: beside('A') })).toBeNull()
    expect(nameFault({ typed: 'A', extension: '', taken: beside('A.md') })).toBeNull()
  })

  test('and a row keeps its own name, since the caller leaves it out', () => {
    expect(nameFault({ typed: 'Plan', extension: '.md', taken: beside('Other.md') })).toBeNull()
  })
})

describe('the extension a commit puts back', () => {
  test('is the one the file was written with, so a vault of .markdown stays one', () => {
    expect(extensionOf('Plan.markdown', false)).toBe('.markdown')
    expect(nameToWrite('Second quarter', '.markdown')).toBe('Second quarter.markdown')
  })

  test('is nothing for a folder, which has none to keep', () => {
    expect(extensionOf('Work', true)).toBe('')
    expect(nameToWrite('Archive', '')).toBe('Archive')
  })

  test('is markdown for a note that somehow has none', () => {
    expect(extensionOf('Readme', false)).toBe('.md')
  })

  test('is not added twice when the field already holds it', () => {
    expect(nameToWrite('paper.pdf', '.pdf')).toBe('paper.pdf')
    expect(nameToWrite('other', '.pdf')).toBe('other.pdf')
  })

  test('is the one the file wrote, whatever case the field holds it in', () => {
    expect(nameToWrite('paper.PDF', '.pdf')).toBe('paper.pdf')
    expect(nameToWrite('NOTE.md', '.MD')).toBe('NOTE.MD')
    expect(nameToWrite('Note.MD', '.md')).toBe('Note.md')
  })

  test('is nothing a dot in the middle of a name made up', () => {
    expect(extensionOf('v1.2 plan.md', false)).toBe('.md')
    expect(nameToWrite('v1.3 plan', extensionOf('v1.2 plan.md', false))).toBe('v1.3 plan.md')
  })

  test('is the ending the list leaves off', () => {
    expect(extensionOf('Board.canvas', false)).toBe('.canvas')
    expect(extensionOf('Sketch.pages', false)).toBe('.pages')
    expect(extensionOf('Svelte docs.url', false)).toBe('.url')
    expect(extensionOf('report.pdf', false)).toBe('.pdf')
    expect(extensionOf('NOTE.MD', false)).toBe('.MD')
    expect(extensionOf('a.canvas.md', false)).toBe('.md')
  })
})

describe('leaving the field', () => {
  const naming = { extension: '.md', taken: beside('Taken.md'), was: 'Plan' }

  test('writes the name that was typed', () => {
    expect(nameToCommit({ ...naming, typed: 'Second quarter' })).toBe('Second quarter.md')
  })

  test('does nothing with a name that cannot be written', () => {
    expect(nameToCommit({ ...naming, typed: 'Work/Plan' })).toBeNull()
    expect(nameToCommit({ ...naming, typed: 'Taken' })).toBeNull()
  })

  test('does nothing with a name nobody changed', () => {
    expect(nameToCommit({ ...naming, typed: 'Plan' })).toBeNull()
    expect(nameToCommit({ ...naming, typed: '  Plan  ' })).toBeNull()
  })

  test('and nothing with an empty field on a row that is being made', () => {
    expect(nameToCommit({ ...naming, was: '', typed: '' })).toBeNull()
    expect(nameToCommit({ ...naming, was: '', typed: 'Fresh' })).toBe('Fresh.md')
  })
})

describe('renaming a file whose name the row cannot say back', () => {
  const site = { extension: '.url', taken: [], was: 'Blog.url', current: 'Blog.url.url' }

  test('writes the name with the ending deleted, as that kind still', () => {
    expect(nameToCommit({ ...site, typed: 'Blog' })).toBe('Blog.url')
    expect(nameToCommit({ ...site, typed: 'Reading list' })).toBe('Reading list.url')
  })

  test('and a note the same way', () => {
    const note = { extension: '.md', taken: [], was: 'Plan.md', current: 'Plan.md.md' }
    expect(nameToCommit({ ...note, typed: 'Plan' })).toBe('Plan.md')
  })

  test('but still nothing for a name nobody changed', () => {
    expect(nameToCommit({ ...site, typed: 'Blog.url' })).toBeNull()
    expect(nameToCommit({ ...site, typed: ' Blog.url ' })).toBeNull()
  })

  test('and nothing for the name the file already has', () => {
    const plain = { extension: '.url', taken: [], was: 'Blog', current: 'Blog.url' }
    expect(nameToCommit({ ...plain, typed: 'Blog.url' })).toBeNull()
    expect(nameToCommit({ ...plain, typed: 'Blog.URL' })).toBeNull()
  })

  test('never leaves a file without its ending', () => {
    for (const ending of ['.url', '.webloc', '.canvas', '.pages', '.md', '.markdown']) {
      const one = { extension: ending, taken: [], was: 'Thing', current: `Thing${ending}` }
      expect(nameToCommit({ ...one, typed: 'Other' })).toBe(`Other${ending}`)
      expect(nameToCommit({ ...one, typed: `Other${ending}` })).toBe(`Other${ending}`)
    }
  })
})

describe('the names the crate keeps for devices', () => {
  const paths = readFileSync(
    fileURLToPath(new URL('../../src-tauri/src/paths.rs', import.meta.url)),
    'utf8',
  )

  test('are the ones this refuses, and no others', () => {
    const block = /pub const RESERVED: \[&str; (\d+)\] = \[([^\]]*)\]/.exec(paths)
    expect(block, 'the crate no longer states RESERVED as a list of names').not.toBeNull()

    const crate = [...(block?.[2] ?? '').matchAll(/"([^"]+)"/g)].map((one) => one[1] ?? '')
    expect(crate).toHaveLength(Number(block?.[1]))

    for (const name of crate) {
      expect(nameFault({ typed: name, extension: '.md', taken: [] }), name).toBe('reserved')
    }

    const refused = ['CON', 'NUL', 'CONIN$', 'CONOUT$', 'COM0', 'COM9', 'COM³', 'LPT¹'].filter(
      (name) => !crate.includes(name),
    )
    expect(refused).toEqual([])
  })
})

describe('the name AGENTS, which a space keeps for its agent instructions', () => {
  const naming = { extension: '.md', taken: beside() }

  test('is refused for a note, however it is spelled, with or without the ending', () => {
    for (const typed of ['AGENTS', 'agents', 'Agents', 'AGENTS.md', 'agents.MD', '  AGENTS  ']) {
      expect(nameFault({ ...naming, typed }), typed).toBe('agents')
    }
  })

  test('goes before a name being taken, since the file at the root is taken by the setting', () => {
    expect(nameFault({ ...naming, typed: 'AGENTS', taken: beside('AGENTS.md') })).toBe('agents')
  })

  test('is free for what is no note: a folder, a space, a canvas', () => {
    expect(nameFault({ extension: '', taken: beside(), typed: 'AGENTS' })).toBeNull()
    expect(nameFault({ extension: '.canvas', taken: beside(), typed: 'AGENTS' })).toBeNull()
  })

  test('and for a name that only starts with it', () => {
    expect(nameFault({ ...naming, typed: 'AGENTS 2' })).toBeNull()
    expect(nameFault({ ...naming, typed: 'My AGENTS' })).toBeNull()
  })

  test('a nested note already called that opens on no fault, and changes case or leaves it', () => {
    const own = { ...naming, current: 'AGENTS.md' }
    expect(nameFault({ ...own, typed: 'AGENTS' })).toBeNull()
    expect(nameFault({ ...own, typed: 'agents' })).toBeNull()
    expect(nameFault({ ...own, typed: 'Rules' })).toBeNull()
  })

  test('writes nothing', () => {
    expect(nameToCommit({ ...naming, typed: 'AGENTS', was: 'Plan', current: 'Plan.md' })).toBeNull()
  })
})
