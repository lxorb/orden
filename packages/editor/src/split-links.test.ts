import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { HIGHLIGHT_COLOURS } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { highlightSelection, setHighlightColour } from './highlight'
import { ordenMarkdownExtensions } from './markdown/extensions'

function stateOf(doc: string, from: number, to: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function pressed(command: ReturnType<typeof toggleWrap>, doc: string, picked: string): string {
  const from = doc.lastIndexOf(picked)
  let state = stateOf(doc, from, from + picked.length)
  command({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('taking a mark off a word next to a link inside the run', () => {
  test('bold off the word after a wikilink keeps the wikilink whole', () => {
    expect(pressed(toggleWrap('**'), '**see [[Note]] now**', 'now')).toBe('**see [[Note]]** now')
  })

  test('bold off the word before a wikilink keeps the wikilink whole', () => {
    expect(pressed(toggleWrap('**'), '**now [[Note]] here**', 'now')).toBe('now **[[Note]] here**')
  })

  test('bold off the word after a markdown link keeps the address whole', () => {
    expect(pressed(toggleWrap('**'), '**read [docs](https://x.com) now**', 'now')).toBe(
      '**read [docs](https://x.com)** now',
    )
  })

  test('italic off the word after inline maths keeps the maths whole', () => {
    expect(pressed(toggleWrap('*'), '*so $x$ holds*', 'holds')).toBe('*so $x$* holds')
  })

  test('highlight off the word after a wikilink keeps the wikilink whole', () => {
    const plain = HIGHLIGHT_COLOURS.find((colour) => colour.emoji === null)
    if (plain) setHighlightColour(plain)
    const doc = '==see [[Note]] now=='
    const from = doc.indexOf('now')
    let state = stateOf(doc, from, from + 3)
    highlightSelection({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('==see [[Note]]== now')
  })
})

describe('taking a mark off a word with only punctuation between it and the end of the run', () => {
  test('bold off a word in brackets at the end of the run leaves no empty marks', () => {
    expect(pressed(toggleWrap('**'), '**Note (important)**', 'important')).toBe('**Note** (important)')
  })

  test('bold off a word in brackets at the start of the run leaves no empty marks', () => {
    expect(pressed(toggleWrap('**'), '**(draft) notes**', 'draft')).toBe('(draft) **notes**')
  })

  test('italic off the last word before a full stop inside the run leaves no empty marks', () => {
    expect(pressed(toggleWrap('*'), '*one two.*', 'two')).toBe('*one* two.')
  })

  test('highlight off a quoted last word leaves no empty marks', () => {
    const plain = HIGHLIGHT_COLOURS.find((colour) => colour.emoji === null)
    if (plain) setHighlightColour(plain)
    const doc = '==say "hello"=='
    const from = doc.indexOf('hello')
    let state = stateOf(doc, from, from + 5)
    highlightSelection({ state, dispatch: (one: Transaction) => (state = one.state) })
    expect(state.doc.toString()).toBe('==say== "hello"')
  })
})
