import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { EditorView } from '@orden/editor'
import Editor from '../../src/lib/pane-tree/src/Editor.svelte'
import { type Tab, workspace } from '../../src/lib/workspace/src/api'
import { reactive } from './runes.svelte'

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  workspace.tabs = []
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  workspace.tabs = []
})

function twoNotes(): [Tab, Tab] {
  workspace.openBlank('One', 'The first note, with words selected in it.')
  workspace.openBlank('Two', 'The second note.')
  const [one, two] = workspace.tabs
  if (!one || !two) throw new Error('two tabs were asked for')

  return [one, two]
}

test('the pane says so when another note is swapped into its editor', async () => {
  const [one, two] = twoNotes()
  const heard: string[] = []
  const props = reactive({
    tab: one,
    kept: [one, two],
    focused: true,
    onselection: (view: EditorView) => heard.push(view.state.doc.toString()),
  })

  const shown = mount(Editor, { target, props })
  close = () => void unmount(shown, { outro: false })
  flushSync()
  await vi.dynamicImportSettled()

  heard.length = 0
  props.tab = two
  flushSync()

  expect(heard.at(-1)).toBe('The second note.')
})
