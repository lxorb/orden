import { afterEach, expect, test, vi } from 'vitest'
import { closeFind, createEditor, type EditorView, openFind } from '@orden/editor'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view = null
  vi.restoreAllMocks()
})

test('the bar closed by Escape closes once, and a selection after it is heard', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const asked: (string | null)[] = []
  let selections = 0
  let finding = false

  const parent = document.createElement('div')
  document.body.append(parent)

  const shut = () => {
    finding = false
    if (view) closeFind(view)
  }

  view = createEditor({
    parent,
    doc: 'Kestrels hover over the field before they drop.',
    onFind: (ask) => {
      asked.push(ask ? 'open' : 'shut')
      if (ask) finding = true
      else shut()
    },
    onSelection: () => {
      selections++
    },
  })

  openFind(view)
  expect(finding).toBe(true)

  shut()

  expect(logged.mock.calls.map((one) => String(one[0]))).toEqual([])
  expect(asked).toEqual(['open', 'shut'])

  const before = selections
  view.dispatch({ selection: { anchor: 0, head: 8 } })
  expect(selections).toBe(before + 1)
  expect(logged).not.toHaveBeenCalled()
})

test('a close with no bar up asks nothing of anybody', () => {
  const heard: unknown[] = []
  const parent = document.createElement('div')
  document.body.append(parent)

  view = createEditor({ parent, doc: 'Nothing looked for.', onFind: (ask) => heard.push(ask) })
  closeFind(view)

  expect(heard).toEqual([])
})
