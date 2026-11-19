import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { aiExtension, aiFenceAt } from './ai/run'
import { fenceCodeAt } from './fence'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { runnableFenceAt } from './run/door'

function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), aiExtension],
    }),
  )
}

describe('fence code of several lines', () => {
  test('in a list item', () => {
    const doc = '- ```js\n  let a = 1\n  let b = 2\n  ```\n'
    expect(runnableFenceAt(stateOf(doc), doc.indexOf('let'))?.code).toBe('let a = 1\nlet b = 2')
  })
  test('in a quote', () => {
    const doc = '> ```js\n> let a = 1\n> let b = 2\n> ```\n'
    expect(fenceCodeAt(stateOf(doc), doc.indexOf('let'))).toBe('let a = 1\nlet b = 2')
  })
  test('ai in a quote', () => {
    const doc = '> ```ai\n> one\n> two\n> ```\n'
    expect(aiFenceAt(stateOf(doc), doc.indexOf('one'))?.prompt).toBe('one\ntwo')
  })
  test('plain', () => {
    const doc = '```js\nlet a = 1\n\nlet b = 2\n```\n'
    expect(fenceCodeAt(stateOf(doc), doc.indexOf('let'))).toBe('let a = 1\n\nlet b = 2')
  })
})
