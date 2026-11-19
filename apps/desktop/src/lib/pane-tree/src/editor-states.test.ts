import {
  documentOf,
  editorState,
  EditorState,
  HeldState,
  SharedDoc,
  StateEffect,
  type StateView,
  type TransactionSpec,
} from '@orden/editor'
import { describe, expect, test } from 'vitest'
import { EditorStates, type NoteTab } from './editor-states'

const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })
class Surface implements StateView {
  state = EditorState.create({})
  at = 0
  readonly scrollDOM = { scrollTop: 0 }
  transactions = 0
  setState(next: EditorState) {
    this.state = next
  }
  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    this.transactions++
    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }
  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
  type(insert: string) {
    const at = this.state.doc.length
    const made = this.state.update({ changes: { from: at, insert }, userEvent: 'input.type' })
    this.state = made.state
    documentOf(this)?.local(made.changes, made.state.selection, this)
  }
}
class Tab implements NoteTab {
  note: { live: SharedDoc; arrivals: number }
  constructor(text: string) {
    this.note = { live: new SharedDoc(text), arrivals: 0 }
  }
  adopt(text: string) {
    this.note.arrivals++
    this.note.live.takeOn(text)
  }
  state(): HeldState {
    return HeldState.waiting(this.note.live, editorState({ shared: this.note.live }))
  }
}
function pane() {
  const states = new EditorStates()
  const view = new Surface()
  return { states, view, show: (tab: Tab) => states.show(view, tab, () => tab.state()) }
}
const twin = (live: SharedDoc): Tab => Object.assign(new Tab(''), { note: { live, arrivals: 0 } })
function shows(view: Surface, tab: Tab) {
  expect(documentOf(view)).toBe(tab.note.live)
  expect(view.state.doc.toString()).toBe(tab.note.live.text.toString())
}
describe('the states a pane keeps', () => {
  test('builds one the first time it shows a note and keeps it after that', () => {
    const { states, view, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    expect(show(alpha)).toBe(true)
    expect(show(beta)).toBe(true)
    expect(show(alpha)).toBe(false)
    expect(states.count).toBe(2)
    shows(view, alpha)
  })
  test('a note switched away from and back to keeps its place', () => {
    const { view, show } = pane()
    const alpha = new Tab('one\ntwo\nthree')
    const beta = new Tab('Beta')
    show(alpha)
    view.at = 8
    show(beta)
    shows(view, beta)
    show(alpha)
    shows(view, alpha)
    expect(view.at).toBe(8)
  })
  test('a note not on show still hears every change made to it', () => {
    const { view, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    show(alpha)
    show(beta)
    alpha.note.live.replace('Alpha renamed')
    show(alpha)
    shows(view, alpha)
    expect(view.state.doc.toString()).toBe('Alpha renamed')
  })
  test('a tab that closes lets its document go', () => {
    const { states, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    show(alpha)
    show(beta)
    expect(alpha.note.live.panes).toBe(1)
    states.keepOnly([beta])
    expect(states.count).toBe(1)
    expect(alpha.note.live.panes).toBe(0)
  })
  test('the note on show stays even when the list forgets to mention it', () => {
    const { states, show } = pane()
    const alpha = new Tab('Alpha')
    show(alpha)
    states.keepOnly([])
    expect(states.count).toBe(1)
    expect(states.shows(alpha)).toBe(true)
  })
  test('a note closed and opened again is built afresh, at the top', () => {
    const { states, view, show } = pane()
    const alpha = new Tab('one\ntwo\nthree')
    const beta = new Tab('Beta')
    show(alpha)
    view.at = 8
    show(beta)
    states.keepOnly([beta])
    const again = new Tab('one\ntwo\nthree')
    view.at = 0
    expect(show(again)).toBe(true)
    expect(view.at).toBe(0)
  })
  test('what a state is dressed for is remembered against its tab', () => {
    const { states, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    expect(states.fitted(alpha)).toBeUndefined()
    show(alpha)
    states.fit(alpha, 'modes and keys')
    expect(states.fitted(alpha)).toBe('modes and keys')
    show(beta)
    states.keepOnly([beta])
    expect(states.fitted(alpha)).toBeUndefined()
  })
  test('the note the view was built on is settled once, not on every look', () => {
    const { states, view, show } = pane()
    const alpha = new Tab('one\ntwo\nthree')
    view.setState(editorState({ shared: alpha.note.live }))
    alpha.note.live.join(view)
    view.transactions = 0
    states.started(alpha, view, scrolledTo.of(8))
    show(alpha)
    expect(view.at).toBe(8)
    expect(view.transactions).toBe(1)
    view.at = 40
    show(alpha)
    expect(view.at).toBe(40)
    expect(view.transactions).toBe(1)
  })
  test('a pane that goes lets go of everything it held, the view included', () => {
    const { states, view, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    show(alpha)
    show(beta)
    states.releaseAll(view)
    expect(states.count).toBe(0)
    expect(documentOf(view)).toBeNull()
    expect(alpha.note.live.panes).toBe(0)
    expect(beta.note.live.panes).toBe(0)
  })
})
describe('which note a state is a state of', () => {
  test('a note renamed is still the same note', () => {
    const { states, show } = pane()
    const tab = new Tab('# Draft')
    show(tab)
    tab.note.live.replace('# Named')
    expect(states.shows(tab)).toBe(true)
    expect(show(tab)).toBe(false)
    expect(states.count).toBe(1)
  })
  test('the preview moving on to another note is another note', () => {
    const { states, view, show } = pane()
    const preview = new Tab('First')
    const kept = new Tab('Kept')
    show(preview)
    view.at = 4
    show(kept)
    preview.adopt('Second')
    view.scrollDOM.scrollTop = 1200
    expect(show(preview)).toBe(true)
    shows(view, preview)
    expect(view.state.doc.toString()).toBe('Second')
    expect(view.scrollDOM.scrollTop).toBe(0)
    expect(states.count).toBe(2)
    expect(preview.note.live.panes).toBe(1)
  })
  test('the preview moving on while it is the note on show is another note', () => {
    const { states, view, show } = pane()
    const preview = new Tab('First')
    show(preview)
    preview.adopt('Second')
    expect(states.shows(preview)).toBe(false)
    expect(show(preview)).toBe(true)
    shows(view, preview)
    expect(states.count).toBe(1)
    expect(preview.note.live.panes).toBe(1)
  })
  test('a tab pointed at another document is another note', () => {
    const { states, view, show } = pane()
    const tab = new Tab('First')
    const already = new SharedDoc('Second')
    show(tab)
    tab.note = { live: already, arrivals: 0 }
    expect(states.shows(tab)).toBe(false)
    expect(show(tab)).toBe(true)
    shows(view, tab)
    expect(states.count).toBe(1)
  })
  test('two tabs on one note are two states of it', () => {
    const { states, view, show } = pane()
    const note = new SharedDoc('Shared')
    const here = twin(note)
    const there = twin(note)
    show(here)
    show(there)
    expect(states.count).toBe(2)
    shows(view, there)
  })
})
describe('a pane switching between notes', () => {
  test('a website and a note, back and forth', () => {
    const { view, show } = pane()
    const note = new Tab('# The note')
    const site = new Tab('[InternetShortcut]\nURL=https://a.example\n')
    show(note)
    shows(view, note)
    show(site)
    shows(view, site)
    show(note)
    shows(view, note)
    site.note.live.replace('[InternetShortcut]\nURL=https://b.example\n', false)
    shows(view, note)
    expect(view.state.doc.toString()).toBe('# The note')
  })
  test('a tab dragged into another pane leaves this one on its own note', () => {
    const left = new EditorStates()
    const right = new EditorStates()
    const here = new Surface()
    const there = new Surface()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    left.show(here, alpha, () => alpha.state())
    left.show(here, beta, () => beta.state())
    left.show(here, alpha, () => alpha.state())
    left.keepOnly([alpha])
    right.show(there, beta, () => beta.state())
    right.keepOnly([beta])
    shows(here, alpha)
    shows(there, beta)
    expect(beta.note.live.panes).toBe(1)
    expect(alpha.note.live.panes).toBe(1)
  })
  test('the same note in two panes is one note with two views', () => {
    const left = new EditorStates()
    const right = new EditorStates()
    const here = new Surface()
    const there = new Surface()
    const note = new SharedDoc('Shared')
    const one = twin(note)
    const two = twin(note)
    left.show(here, one, () => one.state())
    right.show(there, two, () => two.state())
    expect(note.panes).toBe(2)
    shows(here, one)
    shows(there, two)
  })
  test('two documents over one file are two notes wearing one name', () => {
    const { view, show } = pane()
    const first = new Tab('# The note\n')
    const second = new Tab('# The note\n')
    const written: string[] = []
    first.note.live.onChange = (doc) => written.push(doc.toString())
    second.note.live.onChange = (doc) => written.push(doc.toString())
    show(first)
    view.type('written here\n')
    show(second)
    view.type('and written there\n')
    expect(documentOf(view)).toBe(second.note.live)
    expect(first.note.live.text.toString()).toBe('# The note\nwritten here\n')
    expect(second.note.live.text.toString()).toBe('# The note\nand written there\n')
    expect(written).toEqual(['# The note\nwritten here\n', '# The note\nand written there\n'])
  })
  test('closing the tab that is showing leaves the view on the next note', () => {
    const { states, view, show } = pane()
    const alpha = new Tab('Alpha')
    const beta = new Tab('Beta')
    show(alpha)
    show(beta)
    show(alpha)
    states.keepOnly([alpha])
    shows(view, alpha)
    expect(beta.note.live.panes).toBe(0)
    expect(states.count).toBe(1)
  })
})
