// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { modeEffects, type ModeSettings, modeExtensions, setLigatures } from './modes'

const SETTINGS: ModeSettings = {
  source: false,
  readOnly: false,
  focus: false,
  quietMarks: false,
  typewriter: false,
  punctuation: true,
  numbers: false,
  lineNumbers: false,
  codeTheme: 'follow',
  rtl: false,
  strict: false,
  equationNumbers: false,
  spellcheck: false,
  closeBrackets: true,
  vim: false,
}
const classes = (state: EditorState): string[] =>
  state
    .facet(EditorView.editorAttributes)
    .flatMap((attrs) => (typeof attrs === 'object' && attrs.class ? [attrs.class] : []))
test('settings that say nothing of ligatures leave them off, even after they were on', () => {
  const view = new EditorView({ state: EditorState.create({ doc: 'a -> b', extensions: modeExtensions() }) })
  setLigatures(view, 'all')
  expect(classes(view.state)).toContain('orden-ligatures')
  view.dispatch({ effects: modeEffects(SETTINGS) })
  expect(classes(view.state)).not.toContain('orden-ligatures')
  view.destroy()
})
