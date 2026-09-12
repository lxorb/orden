import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { afterEach, describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'
import { setLabels } from '../labels'
import { ANSWER_CLOSE, ANSWER_OPEN } from './block'
import {
  aiExtension,
  aiFenceAt,
  type AiAsk,
  askAiFence,
  askingAt,
  setAiRunner,
  stopAskAt,
} from './run'

/** A view that is a state and a dispatch, which is all asking needs: the whole of
 *  the streaming is document arithmetic, and none of it draws anything. */
class Fake {
  state: EditorState

  constructor(doc: string) {
    this.state = parsed(
      EditorState.create({
        doc,
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
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

const NOTE = 'A note about herons.\n\n```ai\nSummarise @note\n```\n\nAfter it.\n'
const PLAIN = 'A note.\n\n```ai\nJust the question\n```\n'

/** The answers a run wrote, so a test can hold the two callbacks and finish when
 *  it likes. */
function held() {
  let asked: AiAsk | null = null
  let ended: (() => void) | null = null
  let aborted = false

  setAiRunner((ask, signal) => {
    asked = ask
    signal.addEventListener('abort', () => {
      aborted = true
      ended?.()
    })
    return new Promise<void>((resolve) => {
      ended = resolve
    })
  })

  return {
    get ask(): AiAsk {
      if (!asked) throw new Error('nothing was asked')
      return asked
    },
    get aborted() {
      return aborted
    },
    finish: () => ended?.(),
  }
}

afterEach(() => setAiRunner(null))

/** The turn of the loop a finished run tidies up in: the closing mark is drawn
 *  under the answer and the run is forgotten once the promise the app returned has
 *  settled, which is a microtask after it resolves. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('finding the ai fence', () => {
  test('reaches it from inside the question', () => {
    const view = new Fake(NOTE)
    const found = aiFenceAt(view.state, NOTE.indexOf('Summarise'))

    expect(found?.prompt).toBe('Summarise @note')
    expect(found?.from).toBe(NOTE.indexOf('```ai'))
    expect(found?.to).toBe(NOTE.indexOf('```\n\nAfter') + 3)
  })

  test('finds nothing in a fence of another language', () => {
    const view = new Fake('```js\nconsole.log(1)\n```\n')
    expect(aiFenceAt(view.state, 8)).toBeNull()
  })
})

describe('asking', () => {
  test('does nothing without a runner', () => {
    const view = new Fake(NOTE)
    const fence = aiFenceAt(view.state, NOTE.indexOf('Summarise'))

    expect(askAiFence(view, fence!)).toBe(false)
  })

  test('does nothing for a fence with no question in it', () => {
    held()
    const view = new Fake('```ai\n\n```\n')
    const fence = aiFenceAt(view.state, 7)

    expect(askAiFence(view, fence!)).toBe(false)
  })

  test('hands over the note only when the question asked for it', () => {
    const runner = held()
    const view = new Fake(NOTE)
    askAiFence(view, aiFenceAt(view.state, NOTE.indexOf('Summarise'))!)
    expect(runner.ask.note).toBe(NOTE)

    const plain = new Fake(PLAIN)
    askAiFence(plain, aiFenceAt(plain.state, PLAIN.indexOf('Just'))!)
    expect(runner.ask.note).toBeNull()
  })

  test('writes nothing until the model is known', () => {
    held()
    const view = new Fake(NOTE)
    askAiFence(view, aiFenceAt(view.state, NOTE.indexOf('Summarise'))!)

    expect(view.text).toBe(NOTE)
    expect(askingAt(view.state, NOTE.indexOf('```ai'))).toBe(true)
  })

  test('streams the answer under the fence', async () => {
    const runner = held()
    const view = new Fake(NOTE)
    askAiFence(view, aiFenceAt(view.state, NOTE.indexOf('Summarise'))!)

    runner.ask.started('gpt-test')
    runner.ask.wrote('Herons ')
    runner.ask.wrote('stand still.')
    runner.finish()
    await settled()

    expect(view.text).toBe(
      'A note about herons.\n\n```ai\nSummarise @note\n```\n\n' +
        `${ANSWER_OPEN}\n*answered by gpt-test, ${dated()}*\n\nHerons stand still.\n${ANSWER_CLOSE}` +
        '\n\nAfter it.\n',
    )
  })

  test('takes the blank space off the end of what the model sent', async () => {
    const runner = held()
    const view = new Fake(PLAIN)
    askAiFence(view, aiFenceAt(view.state, PLAIN.indexOf('Just'))!)

    runner.ask.started('m')
    runner.ask.wrote('One.\n\n\n')
    runner.finish()
    await settled()

    expect(view.text).toContain(`One.\n${ANSWER_CLOSE}`)
  })

  test('replaces the answer it wrote last time rather than adding a second', async () => {
    const first = held()
    const view = new Fake(NOTE)
    const at = NOTE.indexOf('Summarise')
    askAiFence(view, aiFenceAt(view.state, at)!)
    first.ask.started('m')
    first.ask.wrote('The first answer.')
    first.finish()
    await settled()

    const again = held()
    askAiFence(view, aiFenceAt(view.state, at)!)
    again.ask.started('m2')
    again.ask.wrote('The second.')
    again.finish()
    await settled()

    expect(view.text.match(new RegExp(ANSWER_OPEN, 'g'))).toHaveLength(1)
    expect(view.text).toContain('The second.')
    expect(view.text).not.toContain('The first answer.')
    expect(view.text).toContain('After it.')
  })

  test('keeps what arrived when it is stopped', async () => {
    const runner = held()
    const view = new Fake(PLAIN)
    askAiFence(view, aiFenceAt(view.state, PLAIN.indexOf('Just'))!)

    runner.ask.started('m')
    runner.ask.wrote('As far as')
    stopAskAt(view, PLAIN.indexOf('```ai'))
    await settled()

    expect(runner.aborted).toBe(true)
    expect(view.text).toContain(`As far as\n${ANSWER_CLOSE}`)
    expect(askingAt(view.state, PLAIN.indexOf('```ai'))).toBe(false)
  })

  test('follows the fence when the note above it grows', async () => {
    const runner = held()
    const view = new Fake(PLAIN)
    askAiFence(view, aiFenceAt(view.state, PLAIN.indexOf('Just'))!)
    runner.ask.started('m')

    view.dispatch({ changes: { from: 0, insert: 'A line typed above.\n' } })
    runner.ask.wrote('Still lands right.')
    runner.finish()
    await settled()

    expect(view.text).toContain(`\n\nStill lands right.\n${ANSWER_CLOSE}`)
    expect(view.text.startsWith('A line typed above.\nA note.')).toBe(true)
  })

  test('stops itself when the fence stops being one', async () => {
    const runner = held()
    const view = new Fake(PLAIN)
    const from = PLAIN.indexOf('```ai')
    askAiFence(view, aiFenceAt(view.state, PLAIN.indexOf('Just'))!)

    view.dispatch({ changes: { from, to: from + 3, insert: '' } })
    await settled()

    expect(runner.aborted).toBe(true)
    expect(askingAt(view.state, from)).toBe(false)
  })

  test('refuses a note nobody may write in', () => {
    held()
    const readOnly = parsed(
      EditorState.create({
        doc: PLAIN,
        extensions: [
          markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
          aiExtension,
          EditorState.readOnly.of(true),
        ],
      }),
    )
    const fence = aiFenceAt(readOnly, PLAIN.indexOf('Just'))

    expect(askAiFence({ state: readOnly, dispatch: () => undefined }, fence!)).toBe(false)
  })

  test('says who answered in the words the app gave it', async () => {
    setLabels({ aiAnswered: 'von {model} am {date} beantwortet' })
    const runner = held()
    const view = new Fake(PLAIN)
    askAiFence(view, aiFenceAt(view.state, PLAIN.indexOf('Just'))!)
    runner.ask.started('m')
    runner.finish()
    await settled()
    setLabels({})

    expect(view.text).toContain(`*von m am ${dated()} beantwortet*`)
  })
})

/** Today, spelled the way the answer line spells it. */
function dated(): string {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}
