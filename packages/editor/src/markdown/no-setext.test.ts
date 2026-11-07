import { insertNewlineAndIndent } from '@codemirror/commands'
import {
  insertNewlineContinueMarkupCommand,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions, ordenMarkdownParser } from './extensions'

function names(text: string): string[] {
  const out: string[] = []
  ordenMarkdownParser.parse(text).iterate({
    enter: (node) => {
      out.push(node.name)
    },
  })
  return out
}

function typed(state: EditorState, words: string): EditorState {
  const at = state.selection.main.head
  return state.update({
    changes: { from: at, insert: words },
    selection: EditorSelection.cursor(at + words.length),
  }).state
}

function entered(state: EditorState): EditorState {
  let next = state
  const target = {
    state,
    dispatch: (transaction: Transaction) => {
      next = transaction.state
    },
  }
  if (!insertNewlineContinueMarkupCommand()(target)) insertNewlineAndIndent(target)
  return next
}

function blocksOf(state: EditorState): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 10_000)
  const out: string[] = []
  let child = tree?.topNode.firstChild ?? null
  while (child) {
    out.push(child.name)
    child = child.nextSibling
  }
  return out
}

describe('a line with something under it', () => {
  test('typing words, Enter and a dash keeps the words a paragraph, and the dash starts a list', () => {
    let state = EditorState.create({
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    })
    state = typed(state, 'text')
    state = entered(state)
    state = typed(state, '-')
    expect(state.doc.toString()).toBe('text\n-')
    expect(blocksOf(state)).toEqual(['Paragraph'])

    state = typed(state, ' item')
    expect(blocksOf(state)).toEqual(['Paragraph', 'BulletList'])
  })

  test.each([
    'text\n-',
    'text\n=',
    'text\n---',
    'text\n===',
    'one\ntwo\n---',
    '> text\n> ---',
    '- a\n  text\n  ---',
    'Term\n: text\n---',
  ])('%j makes no heading', (text) => {
    expect(names(text).filter((name) => name.includes('Heading'))).toEqual([])
  })

  test('three dashes under words are a rule, and an equals sign is more of the words', () => {
    expect(names('text\n---')).toEqual(['Document', 'Paragraph', 'HorizontalRule'])
    expect(names('text\n===')).toEqual(['Document', 'Paragraph'])
  })
})
