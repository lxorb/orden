import { describe, expect, test } from 'vitest'
import { nameToWrite } from './naming'
import { type Opener, openerFor } from '../../openers'
import {
  draftName,
  endingOf,
  nameFromContent,
  nameFromTitle,
  rowName,
  shownName,
  titleFrom,
} from '@orden/markdown/note-name'

const lines = (doc: string) => doc.split('\n')

describe('naming a note after its own words', () => {
  test('takes a heading without its hashes', () => {
    expect(nameFromContent('# Shopping list\n\nmilk\n')).toBe('Shopping list')
    expect(nameFromContent('### Deep heading\n')).toBe('Deep heading')
  })

  test('takes plain prose', () => {
    expect(nameFromContent('Meeting notes for Tuesday\n')).toBe('Meeting notes for Tuesday')
  })

  test('skips the blank lines above it', () => {
    expect(nameFromContent('\n\n  \n# Real title\n')).toBe('Real title')
  })

  test('drops a leading bullet or quote', () => {
    expect(nameFromContent('- first item\n')).toBe('first item')
    expect(nameFromContent('> quoted\n')).toBe('quoted')
  })

  test('replaces what a filesystem would refuse', () => {
    expect(nameFromContent('report: q1/q2\n')).toBe('report q1 q2')
    expect(nameFromContent('a<b>c|d*e"f\n')).toBe('a b c d e f')
  })

  test('has nothing to offer for an empty note', () => {
    expect(nameFromContent('')).toBeNull()
    expect(nameFromContent('\n\n   \n')).toBeNull()
  })

  test('has nothing to offer when only markup is left', () => {
    expect(nameFromContent('# \n')).toBeNull()
    expect(nameFromContent('///\n')).toBeNull()
  })

  test('keeps it short enough to be a filename', () => {
    expect(nameFromContent(`# ${'word '.repeat(40)}\n`)!.length).toBeLessThanOrEqual(60)
  })

  test('keeps letters other languages use', () => {
    expect(nameFromContent('# Notizen über Bücher\n')).toBe('Notizen über Bücher')
  })
})

describe('the line a note is titled after', () => {
  test('is the heading, even below a line of prose', () => {
    expect(titleFrom(lines('a stray thought\n\n# The real title\n'))).toBe('The real title')
  })

  test('is the first heading where there are several', () => {
    expect(titleFrom(lines('# One\n\n# Two\n'))).toBe('One')
  })

  test('is the first line with anything on it where there is no heading', () => {
    expect(titleFrom(lines('\n\nplain words\nmore\n'))).toBe('plain words')
  })

  test('does not read the whole note looking for a heading', () => {
    const far = `${'prose\n'.repeat(200)}# Buried\n`
    expect(titleFrom(lines(far))).toBe('prose')
  })

  test('takes a fixed number of lines however many it is offered', () => {
    let pulled = 0

    function* endless() {
      for (let line = 0; line < 100_000; line++) {
        pulled += 1
        yield 'prose'
      }
    }

    titleFrom(endless())
    expect(pulled).toBeLessThanOrEqual(40)
  })

  test('takes lines from anything that hands them over one at a time', () => {
    function* rope() {
      yield ''
      yield '# From an iterator'
    }

    expect(titleFrom(rope())).toBe('From an iterator')
  })

  test('has nothing to say about a note that says nothing', () => {
    expect(titleFrom([])).toBeNull()
    expect(titleFrom(lines('\n  \n'))).toBeNull()
  })
})

describe('what a draft is called on screen', () => {
  test('is its heading', () => {
    expect(draftName(lines('# Tuesday standup\n\nnotes\n'))).toBe('Tuesday standup')
  })

  test('is its first line when it has no heading', () => {
    expect(draftName(lines('ring the dentist\n'))).toBe('ring the dentist')
  })

  test('keeps the punctuation a filename would lose', () => {
    expect(draftName(lines('Q1: costs/savings\n'))).toBe('Q1: costs/savings')
  })

  test('collapses the space inside it', () => {
    expect(draftName(lines('#   two    words  \n'))).toBe('two words')
  })

  test('is nothing at all while the draft says nothing', () => {
    expect(draftName([])).toBeNull()
    expect(draftName(lines('\n\n'))).toBeNull()
  })

  test('stays short enough for a tab', () => {
    expect(draftName(lines(`# ${'word '.repeat(40)}`))!.length).toBeLessThanOrEqual(60)
  })
})

describe('the name a document is listed under', () => {
  test('drops markdown, whichever extension it wears', () => {
    expect(shownName('Today.md')).toBe('Today')
    expect(shownName('Today.markdown')).toBe('Today')
    expect(shownName('Today.MKD')).toBe('Today')
  })

  test('drops a canvas and a page note, the way it drops a note', () => {
    expect(shownName('Board.canvas')).toBe('Board')
    expect(shownName('Board.CANVAS')).toBe('Board')
    expect(shownName('Sketch.pages')).toBe('Sketch')
  })

  test('drops a website, written either way', () => {
    expect(shownName('Svelte docs.url')).toBe('Svelte docs')
    expect(shownName('Page.webloc')).toBe('Page')
  })

  test('drops a chat’s pointer, which the chat is named by', () => {
    expect(shownName('Team.chat')).toBe('Team')
  })

  test('drops the ending of every kind a tab opens but a paper', () => {
    const one: Record<Exclude<Opener, 'pdf'>, string> = {
      note: 'Plan.md',
      web: 'Docs.url',
      pages: 'Journal.pages',
      canvas: 'Board.canvas',
      view: 'Bugs.base',
      chat: 'Team.chat',
      term: 'Claude Code.term',
      application: 'Firefox.application',
    }
    const build = { evenBuild: false, isPlugin: false }
    for (const [kind, name] of Object.entries(one)) {
      expect(
        openerFor(name, () => false, build),
        name,
      ).toBe(kind)
      expect(shownName(name), name).toBe(name.slice(0, name.lastIndexOf('.')))
      expect(nameToWrite(shownName(name), endingOf(name) ?? ''), name).toBe(name)
    }
  })

  test('keeps the extension of a paper, a picture and a file it knows nothing about', () => {
    expect(shownName('Paper.pdf')).toBe('Paper.pdf')
    expect(shownName('Paper.PDF')).toBe('Paper.PDF')
    expect(shownName('shot.png')).toBe('shot.png')
    expect(shownName('notes.txt')).toBe('notes.txt')
  })

  test('leaves an extension in the middle alone', () => {
    expect(shownName('shot.png.canvas')).toBe('shot.png')
    expect(shownName('backup.md.bak')).toBe('backup.md.bak')
    expect(shownName('a.canvas.md')).toBe('a.canvas')
  })

  test('keeps a dot that is part of somebody name', () => {
    expect(shownName('v1.2 plan.md')).toBe('v1.2 plan')
    expect(shownName('v1.2 plan')).toBe('v1.2 plan')
  })

  test('keeps a name that is nothing but an ending', () => {
    expect(shownName('.md')).toBe('.md')
    expect(shownName('.canvas')).toBe('.canvas')
    expect(shownName('.url')).toBe('.url')
  })
})

describe('the name a row of the file list is under', () => {
  test('is the folder own name, whatever it looks like', () => {
    expect(rowName('Papers.pdf', true)).toBe('Papers.pdf')
    expect(rowName('Notes.md', true)).toBe('Notes.md')
    expect(rowName('Work', true)).toBe('Work')
  })

  test('and a file name as every other list shows it', () => {
    expect(rowName('Plan.md', false)).toBe('Plan')
    expect(rowName('report.pdf', false)).toBe('report.pdf')
  })
})

describe('the ending a name wears', () => {
  test('is one of the ones a document is known by', () => {
    expect(endingOf('Plan.md')).toBe('.md')
    expect(endingOf('Plan.markdown')).toBe('.markdown')
    expect(endingOf('Board.canvas')).toBe('.canvas')
    expect(endingOf('Sketch.pages')).toBe('.pages')
    expect(endingOf('Svelte docs.url')).toBe('.url')
  })

  test('in the case the file wrote it in', () => {
    expect(endingOf('NOTE.MD')).toBe('.MD')
    expect(endingOf('Board.CANVAS')).toBe('.CANVAS')
  })

  test('or the file own extension, for a file Orden did not write', () => {
    expect(endingOf('report.pdf')).toBe('.pdf')
    expect(endingOf('shot.png')).toBe('.png')
    expect(endingOf('notes.txt')).toBe('.txt')
    expect(endingOf('backup.md.bak')).toBe('.bak')
  })

  test('and the whole of a name that is nothing else', () => {
    expect(endingOf('.md')).toBe('.md')
    expect(endingOf('.url')).toBe('.url')
  })

  test('and nothing at all where the name wears none', () => {
    expect(endingOf('Readme')).toBeNull()
    expect(endingOf('v1.2 plan')).toBeNull()
    expect(endingOf('.hidden folder')).toBeNull()
  })
})

describe('what a list leaves off and a rename puts back', () => {
  const LISTED = [
    'Plan.md',
    'Plan.markdown',
    'Plan.mdown',
    'Plan.mkd',
    'NOTE.MD',
    'Board.canvas',
    'Board.CANVAS',
    'Sketch.pages',
    'Svelte docs.url',
    'Page.webloc',
    'report.pdf',
    'report.PDF',
    'shot.png',
    'notes.txt',
    '.md',
    '.url',
    'a.canvas.md',
    'v1.2 plan.md',
    'shot.png.canvas',
  ]

  test.each(LISTED)('is the same name again: %s', (name) => {
    expect(nameToWrite(shownName(name), endingOf(name) ?? '')).toBe(name)
  })
})

describe('a title that is a device name', () => {
  test("is not a note's file name", () => {
    expect(nameFromContent('# NUL\n')).toBe('_NUL')
    expect(nameFromContent('con\n')).toBe('_con')
    expect(nameFromTitle('COM¹')).toBe('_COM¹')
    expect(nameFromTitle('CONIN$')).toBe('_CONIN$')
    expect(nameFromTitle('Lpt1 ')).toBe('_Lpt1')
  })

  test('and a name that only starts like one is left as it is', () => {
    expect(nameFromContent('# Console log\n')).toBe('Console log')
    expect(nameFromTitle('COM10')).toBe('COM10')
    expect(nameFromTitle('Nullable')).toBe('Nullable')
  })
})
