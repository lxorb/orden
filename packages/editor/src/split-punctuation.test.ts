import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function stateOf(doc: string, from = 0, to = from): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function pressed(command: ReturnType<typeof toggleWrap>, doc: string, picked: string): string {
  const from = doc.indexOf(picked)
  let state = stateOf(doc, from, from + picked.length)
  command({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

function strong(doc: string): string[] {
  const state = stateOf(doc)
  const found: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'StrongEmphasis') found.push(state.doc.sliceString(node.from, node.to))
    },
  })
  return found
}

describe('taking a mark off a word picked inside a run when punctuation follows the word', () => {
  test('bold over a word followed by a comma leaves the commas outside and the other words bold', () => {
    const done = pressed(toggleWrap('**'), '**apples, pears, plums**', 'pears')
    expect(done).toBe('**apples**, pears, **plums**')
  })

  test('the rest of the run is still bold after taking bold off a word before a full stop', () => {
    const done = pressed(toggleWrap('**'), '**One two. Three four**', 'two')
    expect(strong(done)).toEqual(['**One**', '**Three four**'])
  })

  test('italic over a word followed by a comma leaves the commas outside and the other words italic', () => {
    expect(pressed(toggleWrap('*'), '*one, two, three*', 'two')).toBe('*one*, two, *three*')
  })
})
