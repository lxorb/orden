import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { CompletionContext } from '@codemirror/autocomplete'
import { EditorSelection, EditorState } from '@codemirror/state'
import { afterEach, describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from './markdown/extensions'
import { setBlocks, slashCompletions } from './slash'
import { parsed } from '../test/parsed'

const BLOCKS = [
  { label: 'Table', run: () => undefined },
  { label: 'Task list', run: () => undefined },
  { label: 'Callout', run: () => undefined },
]

/** A context the source can be asked about without a view. `matchBefore` is the
 *  one thing a real one needs a view for, and nothing here uses it. */
function completionsFor(doc: string, at = doc.length) {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )

  return slashCompletions({ state, pos: at, explicit: false } as unknown as CompletionContext)
}

afterEach(() => {
  setBlocks(() => [])
})

describe('a slash on a line', () => {
  test('offers nothing at all until the app has said what the blocks are', () => {
    expect(completionsFor('/')).toBeNull()
  })

  test('opens the list at the start of a line', () => {
    setBlocks(() => BLOCKS)
    expect(completionsFor('/')?.options.map((one) => one.label)).toEqual([
      'Table',
      'Task list',
      'Callout',
    ])
  })

  test('opens it after a space as well', () => {
    setBlocks(() => BLOCKS)
    expect(completionsFor('Words /')).not.toBeNull()
  })

  test('starts the list past the slash, so the rows filter on their own words', () => {
    setBlocks(() => BLOCKS)
    const found = completionsFor('/tab')

    expect(found?.from).toBe('/tab'.length - 'tab'.length)
  })

  test('is not a menu in the middle of a word', () => {
    setBlocks(() => BLOCKS)
    expect(completionsFor('and/or')).toBeNull()
    expect(completionsFor('https://nib.dev')).toBeNull()
    expect(completionsFor('24/7')).toBeNull()
  })

  test('is not a menu inside a fence, which is showing what it holds', () => {
    setBlocks(() => BLOCKS)
    const fenced = '```\nconst path = a\n/\n```'
    expect(completionsFor(fenced, fenced.indexOf('/') + 1)).toBeNull()
  })

  test('is not a menu inside backticks either', () => {
    setBlocks(() => BLOCKS)
    const ticked = 'write `a /` here'
    expect(completionsFor(ticked, ticked.indexOf('/') + 1)).toBeNull()
  })
})

describe('choosing a block', () => {
  test('takes the slash and what was typed after it away, then does the thing', () => {
    const done: string[] = []
    setBlocks(() => [{ label: 'Table', run: () => done.push('ran') }])

    const found = completionsFor('Words\n/tab')
    const option = found?.options[0]
    expect(option).toBeDefined()

    const changes: { from: number; to: number }[] = []
    const view = {
      dispatch: (spec: { changes: { from: number; to: number } }) => changes.push(spec.changes),
    }

    const apply = option?.apply
    if (typeof apply !== 'function') throw new Error('a row has to do something')

    // `from` is past the slash, as the source reports it; `to` is the caret.
    apply(view as never, option as never, 'Words\n/'.length, 'Words\n/tab'.length)

    expect(changes).toEqual([{ from: 'Words\n'.length, to: 'Words\n/tab'.length }])
    expect(done).toEqual(['ran'])
  })
})
