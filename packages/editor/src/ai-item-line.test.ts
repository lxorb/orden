import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { afterEach, describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'
import { aiExtension, aiFenceAt, type AiAsk, askAiFence, askingAt, setAiRunner } from './ai/run'

class Fake {
  state: EditorState

  constructor(doc: string) {
    this.state = parsed(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          aiExtension,
        ],
      }),
    )
  }

  dispatch = (spec: TransactionSpec) => {
    this.state = this.state.update(spec).state
  }

  get text(): string {
    return this.state.doc.toString()
  }
}

afterEach(() => setAiRunner(null))

describe('asking an ai fence written on the list item line itself', () => {
  test('the answer streams in and the ask is not stopped by its own first write', async () => {
    let asked: AiAsk | null = null
    let aborted = false
    let finish: () => void = () => undefined
    setAiRunner((ask, signal) => {
      asked = ask
      signal.addEventListener('abort', () => {
        aborted = true
      })
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })

    const doc = '- ```ai\n  what is a heron\n  ```\n'
    const view = new Fake(doc)
    expect(askAiFence(view, aiFenceAt(view.state, 0)!)).toBe(true)

    const ask = asked as unknown as AiAsk
    ask.started('m')
    expect(aborted).toBe(false)
    ask.wrote('A tall bird.')
    expect(askingAt(view.state, 0)).toBe(true)
    finish()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(view.text).toContain('A tall bird.')
  })
})

describe('the run output of a js fence written on the list item line itself', () => {
  test('stays when words are typed elsewhere in the note', async () => {
    const { openRun, runPanels } = await import('./run/panel')
    const doc = 'Intro\n\n- ```js\n  console.log(1)\n  ```\n'
    let state = parsed(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
          runPanels,
        ],
      }),
    )
    const from = doc.indexOf('- ```js')
    const to = doc.indexOf('```\n', from + 5) + 3
    state = state.update({ effects: openRun.of({ run: 1, from, to, startedAt: 0 }) }).state
    expect(state.field(runPanels)).toHaveLength(1)

    state = state.update({ changes: { from: 5, insert: ' more' } }).state
    expect(state.field(runPanels)).toHaveLength(1)
  })
})
