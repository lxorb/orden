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

describe('a fence written on the list item line itself, as the bar buttons find it', () => {
  test('Run finds the code from the start of the fence line', () => {
    const doc = 'Steps:\n\n- ```js\n  console.log(1)\n  ```\n'
    const lineStart = doc.indexOf('- ```')
    expect(runnableFenceAt(stateOf(doc), doc.indexOf('console'))?.code).toBe('console.log(1)')
    expect(runnableFenceAt(stateOf(doc), lineStart)?.code).toBe('console.log(1)')
  })

  test('Copy copies the code from the start of the fence line', () => {
    const doc = '1. ```js\n   let a = 1\n   ```\n'
    expect(fenceCodeAt(stateOf(doc), 0)).toBe('let a = 1')
  })

  test('Ask finds the question from the start of the fence line', () => {
    const doc = '- ```ai\n  what is a heron\n  ```\n'
    expect(aiFenceAt(stateOf(doc), 0)?.prompt).toBe('what is a heron')
  })

  test('and inside a quote too', () => {
    const doc = '> - ```js\n>   console.log(2)\n>   ```\n'
    expect(runnableFenceAt(stateOf(doc), 0)?.code).toBe('console.log(2)')
  })
})
