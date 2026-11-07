// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { FenceHeaderWidget } from './widgets'

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

test('a language typed for a code block reaches the note when the block is taken off the page first', async () => {
  const doc = '```js\nconst a = 1\n```\n'
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body })
  open.push(view)
  const widget = new FenceHeaderWidget('js', '', 3, 5, 0)
  const dom = widget.toDOM(view)
  document.body.append(dom)

  dom
    .querySelector('.orden-fence-language')
    ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const field = dom.querySelector<HTMLInputElement>('.orden-fence-language-input')
  if (!field) throw new Error('no field to type the language into')
  field.value = 'python'

  dom.remove()
  widget.destroy(dom)
  await Promise.resolve()

  expect(view.state.doc.toString()).toBe('```python\nconst a = 1\n```\n')
})
