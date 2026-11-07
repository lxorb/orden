// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'

const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const heron = EditorView.baseTheme({ '.cm-heron': { color: 'grey' } })
const kestrel = EditorView.baseTheme({ '.cm-kestrel': { color: 'brown' } })

function opened(extensions: (typeof heron)[]): EditorView {
  const view = new EditorView({ parent: document.body, extensions })
  open.push(view)
  return view
}

test('editors whose themes came in another order leave the page styles alone', async () => {
  opened([heron, kestrel])
  opened([kestrel, heron])
  const sheet = [...document.head.querySelectorAll('style')].find((one) =>
    one.textContent.includes('.cm-heron'),
  )
  if (!sheet) throw new Error('no editor styles')
  const text = sheet.textContent

  const writes: MutationRecord[] = []
  const watch = new MutationObserver((records) => writes.push(...records))
  watch.observe(sheet, { childList: true, characterData: true, subtree: true })
  for (let turn = 0; turn < 4; turn++) {
    opened([heron, kestrel])
    opened([kestrel, heron])
  }
  await Promise.resolve()
  watch.disconnect()

  expect(writes).toEqual([])
  expect(sheet.textContent).toBe(text)
  expect(text.match(/\.cm-heron/g)).toHaveLength(1)
})
