import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { namedBlock } from '@orden/markdown/block-names'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { blockNamer } from './block-namer'
import { about, wikilinkCompletions } from './complete'
import {
  linkNameAt,
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndex,
  type NoteRef,
  type SpaceBlock,
} from './notes'
import { parsed } from '../../test/parsed'

interface Asked {
  index: NoteIndex
  reads: string[]
  searches: string[]
}
const note = (path: string, headings: string[] = [], blocks: string[] = []): NoteRef => ({
  path,
  name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
  headings,
  blocks,
  aliases: [],
})
function space(
  notes: NoteRef[],
  options: { path?: string | null; bodies?: Record<string, string>; found?: SpaceBlock[] } = {},
): Asked {
  const asked: Asked = {
    reads: [],
    searches: [],
    index: { notes, files: [], path: null, read: () => Promise.resolve(null) },
  }
  asked.index = {
    notes,
    files: [],
    path: options.path ?? null,
    read: (wanted) => {
      asked.reads.push(wanted)
      return Promise.resolve(options.bodies?.[wanted] ?? null)
    },
    searchBlocks: (text) => {
      asked.searches.push(text)
      return Promise.resolve(options.found ?? [])
    },
  }
  return asked
}
const spelled = (target: LinkWrite): string =>
  `[${target.name}](${target.path ?? ''}|${target.from ?? ''}|${target.fragment ?? ''})`
function state(doc: string, index: NoteIndex, at = doc.length, write?: (target: LinkWrite) => string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
        blockNamer.of((path, line) => Promise.resolve(`from-${path.replace(/\W/g, '')}-${line}`)),
        ...(write ? [linkWriter.of(write)] : []),
      ],
    }),
  )
}
async function rowsFor(doc: string, asked: Asked): Promise<CompletionResult | null> {
  const built = state(doc, asked.index)
  return await wikilinkCompletions(new CompletionContext(built, doc.length, false))
}
const labels = (found: CompletionResult | null): string[] => (found?.options ?? []).map((one) => one.label)
const details = (found: CompletionResult | null): (string | undefined)[] =>
  (found?.options ?? []).map((one) => one.detail)
async function picked(
  doc: string,
  asked: Asked,
  label: string,
  write?: (target: LinkWrite) => string,
): Promise<{ doc: string; head: number }> {
  const found = await rowsFor(doc, asked)
  const row = found?.options.find((one) => one.label === label)
  if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
  let built = state(doc, asked.index, doc.length, write)
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  row.apply(view, row, found.from, doc.length)
  await Promise.resolve()
  await Promise.resolve()
  return { doc: built.doc.toString(), head: built.selection.main.head }
}
const SPACE = [note('Plan.md', ['Today', 'The plan for Monday'], ['a1b2c3']), note('ideas/Spark.md', ['Sparks'])]
describe('every heading of the space, behind `[[##`', () => {
  test('offers them all, with the note each is in beside it', async () => {
    const asked = space(SPACE)
    const found = await rowsFor('[[##', asked)
    expect(labels(found)).toEqual(['Today', 'The plan for Monday', 'Sparks'])
    expect(details(found)).toEqual(['Plan', 'Plan', 'Spark'])
  })
  test('finds one by a few of its letters, wherever they are', async () => {
    expect(labels(await rowsFor('[[##pln', space(SPACE)))).toEqual(['The plan for Monday'])
    expect(labels(await rowsFor('[[##spk', space(SPACE)))).toEqual(['Sparks'])
  })
  test('starts the popup past the two hashes, so the rows filter on the words', async () => {
    const found = await rowsFor('[[##pl', space(SPACE))
    expect(found?.from).toBe('[[##'.length)
  })
  test('writes the whole link and takes the hashes with it', async () => {
    const written = await picked('[[##pln', space(SPACE), 'The plan for Monday')
    expect(written.doc).toBe('[[Plan#The plan for Monday]]')
    expect(written.head).toBe(written.doc.length)
  })
  test('steps over a closing pair that is already there', async () => {
    const asked = space(SPACE)
    const built = state('[[##pln]]', asked.index, '[[##pln'.length)
    const found = await wikilinkCompletions(new CompletionContext(built, '[[##pln'.length, false))
    const row = found?.options[0]
    if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')
    let now = built
    const view = {
      get state() {
        return now
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state
      },
    } as unknown as EditorView
    row.apply(view, row, found.from, '[[##pln'.length)
    expect(now.doc.toString()).toBe('[[Plan#The plan for Monday]]')
    expect(now.selection.main.head).toBe(now.doc.length)
  })
  test('reads no note at all, whatever the space holds', async () => {
    const many = Array.from({ length: 500 }, (_, at) =>
      note(`folder/Note ${at}.md`, ['A heading', 'Another heading', 'A third']),
    )
    const asked = space(many)
    const found = await rowsFor('[[##head', asked)
    expect(asked.reads).toEqual([])
    expect(asked.searches).toEqual([])
    expect(found?.options.length).toBe(40)
  })
  test('leaves the popup to filter what came back rather than asking again', async () => {
    const found = await rowsFor('[[##p', space(SPACE))
    expect(found?.validFor).toBeInstanceOf(RegExp)
    expect((found?.validFor as RegExp).test('plan for')).toBe(true)
  })
})
describe('every block of the space, behind `[[^^`', () => {
  test('offers the ones that already have a name, out of the index', async () => {
    const asked = space(SPACE)
    const found = await rowsFor('[[^^', asked)
    expect(labels(found)).toEqual(['^a1b2c3'])
    expect(details(found)).toEqual(['Plan'])
    expect(asked.searches).toEqual([])
    expect(asked.reads).toEqual([])
  })
  test('writes a link to a named one without touching any note', async () => {
    const asked = space(SPACE)
    const written = await picked('[[^^a1b', asked, '^a1b2c3')
    expect(written.doc).toBe('[[Plan#^a1b2c3]]')
    expect(asked.reads).toEqual([])
  })
  test('asks the space once two characters are in, and never reads a note', async () => {
    const asked = space(SPACE, {
      found: [
        { path: 'ideas/Spark.md', line: 4, text: 'the second half of the plan', id: null },
        { path: 'Plan.md', line: 9, text: 'a plan already named', id: 'zz9999' },
      ],
    })
    const found = await rowsFor('[[^^plan', asked)
    expect(asked.searches).toEqual(['plan'])
    expect(asked.reads).toEqual([])
    expect(labels(found)).toEqual(['the second half of the plan', 'a plan already named'])
    expect(details(found)).toEqual(['Spark', 'Plan'])
  })
  test('links a found block by the name it has', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'Plan.md', line: 9, text: 'a plan already named', id: 'zz9999' }],
    })
    expect((await picked('[[^^plan', asked, 'a plan already named')).doc).toBe('[[Plan#^zz9999]]')
  })
  test('links a found heading as a heading, and names nothing', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'Plan.md', line: 2, text: '## Tasks', id: null }],
    })
    expect((await picked('[[^^tasks', asked, '## Tasks')).doc).toBe('[[Plan#Tasks]]')
  })
  test('names a found line that only looks like a heading, inside code, as a block', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'Plan.md', line: 2, text: '# install deps', id: null }],
      bodies: { 'Plan.md': 'Setup\n```bash\n# install deps\nnpm i\n```\n' },
    })
    expect((await picked('[[^^install', asked, '# install deps')).doc).toBe('[[Plan#^from-Planmd-2]]')
  })
  test('names one that has no name yet, through the app, and links that', async () => {
    const asked = space(SPACE, {
      found: [{ path: 'ideas/Spark.md', line: 4, text: 'the second half', id: null }],
    })
    const written = await picked('[[^^second', asked, 'the second half')
    expect(written.doc).toBe('[[Spark#^from-ideasSparkmd-4]]')
  })
  test('leaves the blocks of the note being written in to `[[#^`', async () => {
    const asked = space(SPACE, {
      path: 'Plan.md',
      found: [{ path: 'Plan.md', line: 2, text: 'a line of this very note', id: null }],
    })
    expect(labels(await rowsFor('[[^^line', asked))).toEqual([])
  })
  test('offers nothing where the editor is standing on its own', async () => {
    const alone: NoteIndex = {
      notes: SPACE,
      files: [],
      path: null,
      read: () => Promise.resolve(null),
    }
    const built = state('[[^^plan', alone)
    const found = await wikilinkCompletions(new CompletionContext(built, '[[^^plan'.length, false))
    expect(labels(found)).toEqual([])
  })
})
describe('the lists that were already there', () => {
  test('a bare `[[` still offers the notes', async () => {
    expect(labels(await rowsFor('[[', space(SPACE)))).toEqual(['Plan', 'Spark'])
  })
  test('`[[Note#` still offers that one note headings', async () => {
    expect(labels(await rowsFor('[[Plan#', space(SPACE)))).toEqual(['Today', 'The plan for Monday'])
  })
  test('`[[Note#^` still reads that one note, and only that one', async () => {
    const asked = space(SPACE, { bodies: { 'Plan.md': 'first block\n\nsecond block\n' } })
    const found = await rowsFor('[[Plan#^', asked)
    expect(asked.reads).toEqual(['Plan.md'])
    expect(labels(found)).toEqual(['first block', 'second block'])
  })
})
test('a decomposed name is offered for what a keyboard types', async () => {
  const found = await rowsFor('[[Über', space([note('U\u0308bersicht.md'), note('Plan.md')]))
  expect(labels(found)).toEqual(['Übersicht'])
})
describe('every row writes the link the app spells', () => {
  const ALIASED: NoteRef[] = [{ ...note('ideas/Spark.md', ['Sparks'], ['b2c3d4']), aliases: ['The spark'] }]
  test('a note row hands over its name, its path and the note being written in', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[Spa', asked, 'Spark', spelled)).doc).toBe('[Spark](ideas/Spark.md|journal/Monday.md|)')
  })
  test('a note and a web shortcut that answer to one name are each named so the link reaches it', async () => {
    const both = [note('Docs.md'), { ...note('x/Docs.url'), name: 'Docs.url' }]
    expect((await picked('[[Doc', space(both, { path: 'x/One.md' }), 'Docs', spelled)).doc).toBe(
      '[/Docs](Docs.md|x/One.md|)',
    )
    expect((await picked('[[Doc', space(both, { path: 'One.md' }), 'Docs.url', spelled)).doc).toBe(
      '[x/Docs.url](x/Docs.url|One.md|)',
    )
  })
  test('a note whose name reads as a file a tab opens is named with its .md', async () => {
    const asked = space([note('Report.pdf.md'), note('x/Ideas.canvas.md')], { path: 'One.md' })
    expect((await picked('[[Rep', asked, 'Report.pdf', spelled)).doc).toBe('[Report.pdf.md](Report.pdf.md|One.md|)')
    expect((await picked('[[Ide', asked, 'Ideas.canvas', spelled)).doc).toBe(
      '[Ideas.canvas.md](x/Ideas.canvas.md|One.md|)',
    )
  })
  test.each(['Board.canvas', 'Docs.url'])(
    'a %s in a folder beside one at the top is named so a tab opens the one picked',
    (name) => {
      const deep = { ...note(`x/${name}`), name }
      const notes = [{ ...note(name), name }, deep]
      const index: NoteIndex = {
        notes,
        files: [name, `x/${name}`],
        path: 'x/One.md',
        read: () => Promise.resolve(null),
      }
      expect(about(index, deep).name).toBe(name)
      expect(about(index, notes[0] ?? deep).name).toBe(`/${name}`)
      expect(about({ ...index, path: 'One.md' }, notes[0] ?? deep).name).toBe(name)
    },
  )
  test('an alias row writes the alias over the note it belongs to', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[spa', asked, 'The spark', spelled)).doc).toBe(
      '[The spark](ideas/Spark.md|journal/Monday.md|)',
    )
  })
  test('an alias row whose alias reaches another note links the note it belongs to', async () => {
    const asked = space([{ ...note('Projects/Project.md'), aliases: ['Roadmap'] }, note('Roadmap.md')], {
      path: 'Journal.md',
    })
    expect((await picked('[[Road', asked, 'Roadmap')).doc).toBe('[[Project|Roadmap]]')
  })
  test('a heading row of one note carries the heading', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[Spark#Spa', asked, 'Sparks', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|Sparks)',
    )
  })
  test('a block row of one note carries the block it already answers to', async () => {
    const asked = space(ALIASED, {
      path: 'journal/Monday.md',
      bodies: { 'ideas/Spark.md': 'a line of it ^b2c3d4\n' },
    })
    expect((await picked('[[Spark#^', asked, 'a line of it', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^b2c3d4)',
    )
  })
  test('a heading in the blocks of one note is linked as that heading', async () => {
    const asked = space(ALIASED, {
      path: 'journal/Monday.md',
      bodies: { 'ideas/Spark.md': '## Tasks ##\n- Buy milk\n' },
    })
    expect((await picked('[[Spark#^', asked, 'Tasks ##', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|Tasks)',
    )
  })
  test('a block the app had to name carries the name it gave it', async () => {
    const asked = space(ALIASED, {
      path: 'journal/Monday.md',
      bodies: { 'ideas/Spark.md': 'a line with no name\n' },
    })
    expect((await picked('[[Spark#^', asked, 'a line with no name', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^from-ideasSparkmd-0)',
    )
  })
  test('a block named above the link still gets its link where the link was typed', async () => {
    const doc = 'first para\n\nsee [[#^'
    const asked = space([note('Here.md')], { path: 'Here.md', bodies: { 'Here.md': doc } })
    const found = await rowsFor(doc, asked)
    const row = found?.options.find((one) => one.label === 'first para')
    if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')
    const view = {
      get state() {
        return built
      },
      dispatch: (spec: TransactionSpec) => {
        built = built.update(spec).state
      },
    } as unknown as EditorView
    let built = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          noteIndex.of(asked.index),
          blockNamer.of(() => {
            view.dispatch({ changes: { from: 'first para'.length, insert: ' ^abc123' } })
            return Promise.resolve('abc123')
          }),
        ],
      }),
    )
    row.apply(view, row, found.from, doc.length)
    await Promise.resolve()
    await Promise.resolve()
    expect(built.doc.toString()).toBe('first para ^abc123\n\nsee [[#^abc123]]')
  })
  test('a `[[##` row carries the heading and takes the hashes with it', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[##spk', asked, 'Sparks', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|Sparks)',
    )
  })
  test('a `[[^^` row out of the index carries the block', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[^^b2c', asked, '^b2c3d4', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^b2c3d4)',
    )
  })
  test('a `[[^^` row the search found carries it too, named or not', async () => {
    const named = space(ALIASED, {
      path: 'journal/Monday.md',
      found: [{ path: 'ideas/Spark.md', line: 9, text: 'already named', id: 'zz9999' }],
    })
    expect((await picked('[[^^alrea', named, 'already named', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^zz9999)',
    )
    const fresh = space(ALIASED, {
      path: 'journal/Monday.md',
      found: [{ path: 'ideas/Spark.md', line: 4, text: 'not named yet', id: null }],
    })
    expect((await picked('[[^^not n', fresh, 'not named yet', spelled)).doc).toBe(
      '[Spark](ideas/Spark.md|journal/Monday.md|^from-ideasSparkmd-4)',
    )
  })
  test('a heading of this very note hands over no name at all', async () => {
    const asked = space([note('Plan.md', ['Today'])], { path: 'Plan.md' })
    expect((await picked('[[#Tod', asked, 'Today', spelled)).doc).toBe('[](Plan.md|Plan.md|Today)')
  })
  test('writes a wikilink where nothing told it otherwise, as it always has', async () => {
    const asked = space(ALIASED, { path: 'journal/Monday.md' })
    expect((await picked('[[Spa', asked, 'Spark')).doc).toBe('[[Spark]]')
    expect((await picked('[[Spark#Spa', asked, 'Sparks')).doc).toBe('[[Spark#Sparks]]')
  })
})
describe('a note the space has archived', () => {
  const archived = (path: string): NoteRef => ({ ...note(path), archived: true })
  test('is not offered for part of its name', async () => {
    const asked = space([note('Plan.md'), archived('Planning 2019.md')])
    expect(labels(await rowsFor('[[Plan', asked))).toEqual(['Plan'])
  })
  test('but is for the whole of it, and says it is archived', async () => {
    const asked = space([note('Plan.md'), archived('Planning 2019.md')])
    const found = await rowsFor('[[Planning 2019', asked)
    expect(labels(found)).toEqual(['Planning 2019'])
    expect(details(found)).toEqual(['Archived'])
  })
  test('and its headings and blocks stay out of the space-wide lists', async () => {
    const asked = space([
      { ...note('Old.md', ['Summary'], ['abc']), archived: true },
      note('New.md', ['Summary'], ['abd']),
    ])
    expect(details(await rowsFor('[[##Summ', asked))).toEqual(['New'])
    expect(labels(await rowsFor('[[^^ab', asked))).toEqual(['^abd'])
  })
})
async function pickedAt(
  doc: string,
  caret: number,
  asked: Asked,
  label: string,
  write?: (target: LinkWrite) => string,
): Promise<string> {
  let built = state(doc, asked.index, caret, write)
  const found = await wikilinkCompletions(new CompletionContext(built, caret, false))
  const row = found?.options.find((one) => one.label === label)
  if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  row.apply(view, row, found.from, caret)
  return built.doc.toString()
}
describe('a link picked into front matter', () => {
  const asked = () => space([note('Plan.md', ['Goals'])])
  const markdown = (target: LinkWrite) => `[${target.name}](${target.name}.md)`
  test('is quoted when it is a markdown link, so the YAML still reads', async () => {
    const doc = '---\nup: [[Pl\n---\n# Note\n'
    expect(await pickedAt(doc, doc.indexOf('[[Pl') + 4, asked(), 'Plan', markdown)).toBe(
      '---\nup: "[Plan](Plan.md)"\n---\n# Note\n',
    )
    const listed = '---\nrefs:\n  - [[Pl\n---\n'
    expect(await pickedAt(listed, listed.indexOf('[[Pl') + 4, asked(), 'Plan', markdown)).toBe(
      '---\nrefs:\n  - "[Plan](Plan.md)"\n---\n',
    )
  })
  test('is left as it is when it is a wikilink, or in the body', async () => {
    const doc = '---\nup: [[Pl\n---\n'
    expect(await pickedAt(doc, doc.indexOf('[[Pl') + 4, asked(), 'Plan')).toBe('---\nup: [[Plan]]\n---\n')
    const body = '---\na: 1\n---\nup: [[Pl\n'
    expect(await pickedAt(body, body.length - 1, asked(), 'Plan', markdown)).toBe(
      '---\na: 1\n---\nup: [Plan](Plan.md)\n',
    )
  })
})
describe('a name picked inside a link already written', () => {
  const asked = () => space([note('Plan.md', ['Goals'])])
  const caretAfter = (doc: string, typed: string) => doc.indexOf(typed) + typed.length
  test('keeps the words it is shown as', async () => {
    const doc = 'see [[Pl|the plan]] end'
    expect(await pickedAt(doc, caretAfter(doc, '[[Pl'), asked(), 'Plan')).toBe('see [[Plan|the plan]] end')
  })
  test('keeps the heading it names', async () => {
    const doc = 'see [[Pl#Goals]] end'
    expect(await pickedAt(doc, caretAfter(doc, '[[Pl'), asked(), 'Plan')).toBe('see [[Plan#Goals]] end')
  })
  test('takes the place of the rest of the old name', async () => {
    const doc = 'see [[Plxx]] end'
    expect(await pickedAt(doc, caretAfter(doc, '[[Pl'), asked(), 'Plan')).toBe('see [[Plan]] end')
  })
  test('a heading picked keeps the words the link is shown as', async () => {
    const doc = '[[Plan#Go|alias]]'
    expect(await pickedAt(doc, caretAfter(doc, '#Go'), asked(), 'Goals')).toBe('[[Plan#Goals|alias]]')
  })
})
describe('a name two notes share, picked', () => {
  test('is written so that it reaches the note picked from where the link is', async () => {
    const asked = space([note('Plan.md'), note('ideas/Plan.md'), note('ideas/One.md')], {
      path: 'ideas/One.md',
    })
    const found = await rowsFor('[[Pla', asked)
    const rows = found?.options.filter((one) => one.label === 'Plan') ?? []
    const written = rows.map((row) => {
      let built = state('[[Pla', asked.index)
      const view = {
        get state() {
          return built
        },
        dispatch: (spec: TransactionSpec) => {
          built = built.update(spec).state
        },
      } as unknown as EditorView
      if (typeof row.apply === 'function') row.apply(view, row, found?.from ?? 0, '[[Pla'.length)
      return built.doc.toString()
    })
    expect(written.sort()).toEqual(['[[/Plan]]', '[[Plan]]'])
  })
})
describe('a row after an alias and a hash', () => {
  test('carries the name that says which file, for the shortest markdown link', async () => {
    const asked = space(
      [{ ...note('A/Project.md', ['Goals']) }, { ...note('B/Project.md', ['Goals']), aliases: ['Roadmap'] }],
      { path: 'A/Journal.md' },
    )
    const carried = (target: LinkWrite) => `${target.name}|${target.file ?? ''}`
    expect((await picked('[[Roadmap#Go', asked, 'Goals', carried)).doc).toBe('Roadmap|B/Project')
  })
})
describe('the name a copied link to a note is written with', () => {
  test('is enough of the path to say which, when another note shares the name', () => {
    const asked = space([note('Plan.md'), note('Work/Plan.md'), note('Ideas.md')])
    const built = state('', asked.index)
    expect(linkNameAt(built, 'Work/Plan.md')).toBe('Work/Plan')
    expect(linkNameAt(built, 'Ideas.md')).toBe('Ideas')
    expect(linkNameAt(built, 'Gone.md')).toBeNull()
  })
})
test('naming a block above, in the note being written, links it where the link was typed', async () => {
  const doc = 'first block\n\n[[#^'
  const index: NoteIndex = {
    notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }],
    files: [],
    path: 'Plan.md',
    read: () => Promise.resolve('first block\n\n'),
  }
  let built: EditorState
  const view = {
    get state() {
      return built
    },
    dispatch: (spec: TransactionSpec) => {
      built = built.update(spec).state
    },
  } as unknown as EditorView
  built = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
        blockNamer.of((_path, line) => {
          view.dispatch({ changes: { from: built.doc.line(line + 1).to, insert: ' ^abc' } })
          return Promise.resolve('abc')
        }),
      ],
    }),
  )
  const found = await wikilinkCompletions(new CompletionContext(built, doc.length, false))
  const row = found?.options.find((one) => one.label === 'first block')
  if (!found || !row || typeof row.apply !== 'function') throw new Error('no row for the block')
  row.apply(view, row, found.from, doc.length)
  await new Promise((settle) => setTimeout(settle, 0))
  expect(built.doc.toString()).toBe('first block ^abc\n\n[[#^abc]]')
})
describe('naming a block in the note being written, as the note is written', () => {
  const changed = (was: string, now: string) => {
    let start = 0
    while (start < was.length && was[start] === now[start]) start++
    let end = 0
    while (end < was.length - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end++
    return { from: start, to: was.length - end, insert: now.slice(start, now.length - end) }
  }
  const picked = async (doc: string, label: string, at = doc.length, typed = '') => {
    const index: NoteIndex = {
      notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }],
      files: [],
      path: 'Plan.md',
      read: () => Promise.resolve(doc),
    }
    let built: EditorState
    const view = {
      get state() {
        return built
      },
      dispatch: (spec: TransactionSpec) => {
        built = built.update(spec).state
      },
    } as unknown as EditorView
    built = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(at),
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          noteIndex.of(index),
          blockNamer.of((_path, line) => {
            const was = built.doc.toString()
            const named = namedBlock(was, line, () => 'abc')
            if (!named) return Promise.resolve(null)
            if (named.source !== was) view.dispatch({ changes: changed(was, named.source) })
            if (typed) view.dispatch({ changes: { from: built.doc.length, insert: typed } })
            return Promise.resolve(named.id)
          }),
        ],
      }),
    )
    const found = await wikilinkCompletions(new CompletionContext(built, at, false))
    const row = found?.options.find((one) => one.label === label)
    if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
    row.apply(view, row, found.from, at)
    await new Promise((settle) => setTimeout(settle, 0))
    return built.doc.toString()
  }
  test('links a block that runs onto the line being typed', async () => {
    expect(await picked('first block\n[[#^', 'first block')).toBe('first block\n[[#^abc]] ^abc')
  })
  test('links a block the link sits inside', async () => {
    expect(await picked('one\ntwo [[#^\nthree', 'one', 'one\ntwo [[#^'.length)).toBe('one\ntwo [[#^abc]]\nthree ^abc')
  })
  test('links the block from the second of two links to blocks on one line', async () => {
    expect(await picked('second block\n\n[[#^a]] [[#^', 'second block')).toBe('second block ^abc\n\n[[#^a]] [[#^abc]]')
  })
  test('keeps what the reader typed while the block was named', async () => {
    expect(await picked('first block\n\n[[#^', 'first block', undefined, ' and')).toBe(
      'first block ^abc\n\n[[#^abc]] and',
    )
  })
})
describe('picking a row while mending a link already written', () => {
  const mended = async (doc: string, at: number, label: string) => {
    const index: NoteIndex = {
      notes: [note('Plan.md', ['Head']), note('Planet.md')],
      files: [],
      path: 'Notes.md',
      read: () => Promise.resolve(null),
    }
    let built = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(at),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(index)],
      }),
    )
    const view = {
      get state() {
        return built
      },
      dispatch: (spec: TransactionSpec) => {
        built = built.update(spec).state
      },
    } as unknown as EditorView
    const found = await wikilinkCompletions(new CompletionContext(built, at, false))
    const row = found?.options.find((one) => one.label === label)
    if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)
    row.apply(view, row, found.from, at)
    return built.doc.toString()
  }
  test('keeps the words the link shows', async () => {
    expect(await mended('see [[Plan|the plan]] now', 10, 'Plan')).toBe('see [[Plan|the plan]] now')
  })
  test('keeps the heading it reaches', async () => {
    expect(await mended('see [[Plan#Head]] now', 10, 'Plan')).toBe('see [[Plan#Head]] now')
  })
  test('a heading row keeps the words the link shows', async () => {
    expect(await mended('see [[Plan#Hea|the plan]] now', 14, 'Head')).toBe('see [[Plan#Head|the plan]] now')
  })
  test('leaves the next link on the line alone', async () => {
    expect(await mended('see [[Pla and [[Planet]]', 9, 'Plan')).toBe('see [[Plan]] and [[Planet]]')
  })
})
