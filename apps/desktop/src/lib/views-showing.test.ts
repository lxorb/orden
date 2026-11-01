import { documentOf, EditorState, SharedDoc, type TransactionSpec } from '@orden/editor'
import { describe, expect, test } from 'vitest'
import { viewShowing, WhenShown } from './views.svelte'

/** A pane's one view, without a DOM, joined to whichever note it shows. */
class Surface {
  state = EditorState.create({})

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
  }

  /** What a pane does when another of its tabs comes to the front. */
  show(tab: Tab) {
    documentOf(this)?.leave(this)
    this.state = EditorState.create({ doc: tab.note.live.text })
    tab.note.live.join(this)
  }
}

class Tab {
  note: { live: SharedDoc }

  constructor(
    readonly id: string,
    text: string,
    readonly paneId = 'pane',
  ) {
    this.note = { live: new SharedDoc(text) }
  }
}

/** Notes A and B in one pane, B in front, and the outline held on A. */
function heldBehind() {
  const view = new Surface()
  const a = new Tab('a', '# A one\n# A two\n')
  const b = new Tab('b', '# B one\n# B two\n')
  view.show(b)
  const tabs = [a, b]
  const viewOf = (paneId: string) => (paneId === 'pane' ? view : undefined)
  return { view, a, b, tabs, viewOf }
}

describe('the note an outline acts on', () => {
  test('a tab behind another in its pane has no view to act through', () => {
    const { a, b, view, viewOf } = heldBehind()

    expect(viewShowing(a, viewOf)).toBeNull()
    expect(viewShowing(b, viewOf)).toBe(view)
  })

  test('an action waits for the pane to show the note, and never runs on the one in front', () => {
    const { a, b, view, tabs, viewOf } = heldBehind()
    const shown = new WhenShown((id) => tabs.find((tab) => tab.id === id), viewOf)
    const acted: string[] = []

    expect(shown.run(a, (on) => acted.push(on.state.doc.toString()))).toBe(false)
    expect(acted).toEqual([])

    view.show(a)
    shown.settle()
    expect(acted).toEqual(['# A one\n# A two\n'])

    // Spent: showing B and A again does not run it twice.
    view.show(b)
    view.show(a)
    shown.settle()
    expect(acted).toHaveLength(1)
    expect(b.note.live.text.toString()).toBe('# B one\n# B two\n')
  })

  test('an action whose note never came to the front is dropped, not run later', () => {
    const { a, tabs, view, viewOf } = heldBehind()
    const shown = new WhenShown((id) => tabs.find((tab) => tab.id === id), viewOf)
    let acted = 0

    shown.run(a, () => acted++)
    shown.settle()
    view.show(a)
    shown.settle()

    expect(acted).toBe(0)
  })

  test('a note already in front is acted on at once', () => {
    const { b, tabs, view, viewOf } = heldBehind()
    const shown = new WhenShown((id) => tabs.find((tab) => tab.id === id), viewOf)
    let on: unknown = null

    expect(shown.run(b, (one) => (on = one))).toBe(true)
    expect(on).toBe(view)
  })
})
