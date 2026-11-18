// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { carryIntoEditors, createEditor, editorState } from '../editor'
import { HeldState } from '../held'
import { SharedDoc } from '../shared'
import { ANSWER_CLOSE, ANSWER_OPEN } from './block'
import { aiExtension, aiFenceAt, type AiAsk, askAiFence, askingAt, setAiRunner } from './run'

const NOTE = 'A note about herons.\n\n```ai\nSummarise this\n```\n\nAfter it.\n'
const OTHER = 'Another note.\n\n```ai\nSummarise this\n```\n\nAfter it.\n'
const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  carryIntoEditors(aiExtension)
})

afterEach(() => {
  setAiRunner(null)
  for (const view of open.splice(0)) view.destroy()
})

function asked() {
  let ask: AiAsk | null = null
  let ended: (() => void) | null = null

  setAiRunner(
    (given) =>
      new Promise<void>((resolve) => {
        ask = given
        ended = resolve
      }),
  )

  return {
    get ask(): AiAsk {
      if (!ask) throw new Error('nothing was asked')
      return ask
    },
    finish: () => ended?.(),
  }
}

async function settled() {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function dated(): string {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

function answered(note: string, words: string): string {
  const after = note.indexOf('\n\nAfter it.')
  return (
    `${note.slice(0, after)}\n\n` +
    `${ANSWER_OPEN}\n*answered by m, ${dated()}*\n\n${words}\n${ANSWER_CLOSE}` +
    note.slice(after)
  )
}

function panes(otherText = OTHER) {
  const first = new SharedDoc(NOTE)
  const second = new SharedDoc(otherText)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  forceParsing(view, view.state.doc.length, 10_000)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))

  return {
    first,
    second,
    view,
    firstHeld,
    away() {
      firstHeld.take(view)
      secondHeld.give(view)
    },
    back() {
      secondHeld.take(view)
      firstHeld.give(view)
    },
  }
}

function ask(view: EditorView) {
  const fence = aiFenceAt(view.state, view.state.doc.toString().indexOf('Summarise'))
  if (!fence) throw new Error('no ai fence found')
  expect(askAiFence(view, fence)).toBe(true)
}

test('words that arrive while the note is in the background land in that note', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  runner.ask.started('m')
  runner.ask.wrote('Herons ')
  pane.away()
  runner.ask.wrote('stand ')
  runner.ask.wrote('still.')
  pane.back()
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(answered(NOTE, 'Herons stand still.'))
  expect(pane.view.state.doc.toString()).toBe(answered(NOTE, 'Herons stand still.'))
  expect(pane.second.text.toString()).toBe(OTHER)
  expect(askingAt(pane.view.state, NOTE.indexOf('```ai'))).toBe(false)
})

test('an answer that starts after the note was left is written into that note', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  pane.away()
  runner.ask.started('m')
  runner.ask.wrote('Herons stand still.')
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(answered(NOTE, 'Herons stand still.'))
  expect(pane.second.text.toString()).toBe(OTHER)
  expect(pane.view.state.doc.toString()).toBe(OTHER)

  pane.back()
  expect(pane.view.state.doc.toString()).toBe(answered(NOTE, 'Herons stand still.'))
  expect(askingAt(pane.view.state, NOTE.indexOf('```ai'))).toBe(false)
})

test('an answer that finishes while the note is away is closed on its own note', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  runner.ask.started('m')
  runner.ask.wrote('Herons stand still.\n\n')
  pane.away()
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(answered(NOTE, 'Herons stand still.'))
  expect(askingAt(pane.firstHeld.state, NOTE.indexOf('```ai'))).toBe(false)
  expect(pane.second.text.toString()).toBe(OTHER)

  pane.back()
  expect(askingAt(pane.view.state, NOTE.indexOf('```ai'))).toBe(false)
  expect(pane.view.state.doc.toString()).toBe(answered(NOTE, 'Herons stand still.'))
})

test('words written into the background note meanwhile keep the answer in place', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  runner.ask.started('m')
  pane.away()
  pane.first.edit([{ from: 0, to: 0, insert: 'Above.\n' }])
  runner.ask.wrote('Herons stand still.')
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(answered(`Above.\n${NOTE}`, 'Herons stand still.'))
  expect(pane.second.text.toString()).toBe(OTHER)
})

test('words typed above the fence just before the switch still leave the answer in place', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  runner.ask.started('m')
  runner.ask.wrote('Herons ')
  pane.view.dispatch({ changes: { from: 0, insert: 'Typed.\n' }, userEvent: 'input' })
  pane.away()
  runner.ask.wrote('stand still.')
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(answered(`Typed.\n${NOTE}`, 'Herons stand still.'))
  expect(pane.second.text.toString()).toBe(OTHER)
  pane.back()
  expect(askingAt(pane.view.state, pane.view.state.doc.toString().indexOf('```ai'))).toBe(false)
})

test('an answer whose tab is reused for another note is not written into that note', async () => {
  const runner = asked()
  const pane = panes()
  ask(pane.view)

  pane.first.takeOn(OTHER)
  runner.ask.started('m')
  runner.ask.wrote('Herons stand still.')
  runner.finish()
  await settled()

  expect(pane.first.text.toString()).toBe(OTHER)
  expect(pane.view.state.doc.toString()).toBe(OTHER)
})
