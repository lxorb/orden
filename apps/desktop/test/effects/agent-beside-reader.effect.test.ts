import { EditorState, EditorView } from '@orden/editor'
import { afterEach, beforeEach, expect, test } from 'vitest'

const { workspace } = await import('../../src/lib/workspace.svelte')
const { callerOf } = await import('../../src/lib/automation/caller')
const { runAgentVerb } = await import('../../src/lib/agents/workspace/index')
const { agentMarks } = await import('../../src/lib/agent-marks.svelte')

const agent = callerOf({
  id: 'claude',
  name: 'Claude',
  scopes: [
    'context',
    'notes.read',
    'notes.write',
    'tree',
    'workspace',
    'workspace.focus',
    'browser',
    'browser.reader',
    'terminal',
  ],
  spaces: 'all',
  mode: 'autonomous',
})

let view: EditorView | null = null

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

afterEach(() => {
  view?.destroy()
  view = null
  document.body.replaceChildren()
})

function reading() {
  const words = `${'line\n'.repeat(80)}alpha beta gamma\n${'more\n'.repeat(80)}`
  const tab = workspace.openUnsaved('note', words, undefined, null, true)
  workspace.activate(tab.id)
  const parent = document.createElement('div')
  parent.style.height = '200px'
  document.body.append(parent)
  view = new EditorView({
    state: EditorState.create({ doc: tab.note.live.text }),
    parent,
  })
  tab.note.live.join(view)
  const at = words.indexOf('beta')
  view.dispatch({ selection: { anchor: at, head: at + 4 } })
  view.focus()
  view.scrollDOM.scrollTop = 120
  return tab
}

function readerState() {
  const state = view?.state
  const main = state?.selection.main
  return {
    front: workspace.activeTabId,
    keyboard: document.activeElement === view?.contentDOM,
    chosen: main ? view?.state.sliceDoc(main.from, main.to) : null,
    caretAtEnd: main ? main.head === main.to : null,
    scroll: view?.scrollDOM.scrollTop ?? null,
  }
}

test('nothing an agent does moves the reader’s tab, keyboard, selection or scroll', async () => {
  const tab = reading()
  const before = readerState()
  expect(before).toMatchObject({ front: tab.id, keyboard: true, chosen: 'beta', scroll: 120 })

  const runs: [string, Record<string, unknown>][] = [
    ['workspace_tabs', { op: 'new', kind: 'note', content: 'An agent’s note' }],
    ['workspace_tabs', { op: 'new', kind: 'canvas' }],
    ['workspace_tabs', { op: 'new', kind: 'web', url: 'https://docs.example/' }],
    ['workspace_tabs', { op: 'open', url: 'https://docs.example/b' }],
    ['workspace_tabs', { op: 'list' }],
    ['get_context', {}],
    ['edit_note', { tab: tab.id, edits: [{ at: { start: true }, insert_before: 'AGENT\n' }] }],
    ['edit_note', { tab: tab.id, edits: [{ at: { end: true }, insert_after: '\nTHE END' }] }],
    ['read_note', { tab: tab.id }],
  ]
  for (const [verb, args] of runs) {
    const said = await runAgentVerb(verb, args, agent)
    expect(said, `${verb} ${JSON.stringify(said)}`).not.toMatchObject({ ok: false })
    expect(readerState(), `${verb} ${JSON.stringify(args)}`).toEqual(before)
  }

  const words = view?.state.doc.toString() ?? ''
  expect(words.startsWith('AGENT\n')).toBe(true)
  expect(words.trimEnd().endsWith('THE END')).toBe(true)
  expect(Object.keys(agentMarks.opened).length).toBeGreaterThan(0)
  expect(Object.keys(agentMarks.opened)).not.toContain(tab.id)
})
