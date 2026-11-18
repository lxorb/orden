import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { blockNamer } from './block-namer'
import { wikilinkCompletions } from './complete'
import {
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

function note(path: string, headings: string[] = [], blocks: string[] = []): NoteRef {
  return {
    path,
    name: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
    headings,
    blocks,
    aliases: [],
  }
}

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

function state(
  doc: string,
  index: NoteIndex,
  at = doc.length,
  write?: (target: LinkWrite) => string,
): EditorState {
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

const SPACE = [
  note('Plan.md', ['Today', 'The plan for Monday'], ['a1b2c3']),
  note('ideas/Spark.md', ['Sparks']),
]

describe('a block named while its link is picked', () => {
  test('lands the link where the typing has gone, after the name went into this note', async () => {
    const doc = 'Alpha para\n\nSee [[Plan#^alp'
    const asked = space([note('Plan.md')], { bodies: { 'Plan.md': 'Alpha para\n' } })
    const found = await wikilinkCompletions(
      new CompletionContext(state(doc, asked.index), doc.length, false),
    )
    const row = found?.options.find((one) => one.label === 'Alpha para')
    if (!found || !row || typeof row.apply !== 'function') throw new Error('no row')

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
          noteIndex.of(asked.index),
          blockNamer.of(() => {
            view.dispatch({ changes: { from: 10, insert: ' ^abc123' } })
            return Promise.resolve('abc123')
          }),
        ],
      }),
    )

    row.apply(view, row, found.from, doc.length)
    await Promise.resolve()
    await Promise.resolve()

    expect(built.doc.toString()).toBe('Alpha para ^abc123\n\nSee [[Plan#^abc123]]')
  })
})

describe('a suggestion picked inside a link already written', () => {
  async function pickedAt(written: string, label: string): Promise<string> {
    const caret = written.indexOf('|')
    const doc = written.replace('|', '')
    const asked = space([note('Project Plan.md', ['Heading one']), note('Other.md')])
    const built = state(doc, asked.index, caret)
    const found = await wikilinkCompletions(new CompletionContext(built, caret, false))
    const row = found?.options.find((one) => one.label === label)
    if (!found || !row || typeof row.apply !== 'function') throw new Error(`no row for ${label}`)

    let now = built
    const view = {
      get state() {
        return now
      },
      dispatch: (spec: TransactionSpec) => {
        now = now.update(spec).state
      },
    } as unknown as EditorView
    row.apply(view, row, found.from, caret)
    return now.doc.toString()
  }

  test('takes the rest of the name it was typed in', async () => {
    expect(await pickedAt('see [[Proje|ct Plan]] now', 'Project Plan')).toBe(
      'see [[Project Plan]] now',
    )
  })

  test('and keeps a heading or a label written after the name', async () => {
    expect(await pickedAt('[[Proje|ct Plan#Heading one]]', 'Project Plan')).toBe(
      '[[Project Plan#Heading one]]',
    )
    expect(await pickedAt('[[Proje|ct Plan|the plan]]', 'Project Plan')).toBe(
      '[[Project Plan|the plan]]',
    )
    expect(await pickedAt('[[Proje|ct Plan\\|the plan]]', 'Project Plan')).toBe(
      '[[Project Plan\\|the plan]]',
    )
  })
})

describe('in code', () => {
  test('two brackets open no suggestions', async () => {
    const doc = '```py\ngrid = [[\n```\n'
    const built = state(doc, space(SPACE).index, doc.indexOf('[[') + 2)
    expect(
      await wikilinkCompletions(new CompletionContext(built, doc.indexOf('[[') + 2, false)),
    ).toBeNull()
  })
})
