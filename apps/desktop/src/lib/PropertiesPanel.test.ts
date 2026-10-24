import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** What the Properties panel draws for the note in front: a row per key with the
 *  control its value asks for, the YAML where the block is one nib cannot read, and no
 *  controls at all where the note may not be written. Rendered on the server, the way
 *  Sidebar.test does beside it: the markup is what a reader gets. What a control
 *  writes is property-edits.ts's, tested there, and the drive presses them. */

vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, following: null } }))

const { workspace } = await import('./workspace.svelte')
const { modes } = await import('./modes.svelte')
const PropertiesPanel = (await import('./PropertiesPanel.svelte')).default

function drawn(text: string, path: string | null = null): string {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('Card', text)
  const tab = workspace.tabs.at(-1)
  if (tab && path !== null) tab.path = path
  return render(PropertiesPanel, { props: {} }).body
}

describe('the rows', () => {
  const NOTE =
    '---\nstatus: draft\ntags: [birds, notes]\ndone: true\ncount: 3\ndue: 2026-10-01\npaper: A4\n---\nWords.\n'

  test('are the note’s keys, in the order the block says them', () => {
    const keys = [...drawn(NOTE).matchAll(/data-key="([^"]+)"/g)].map(([, key]) => key)
    expect(keys).toEqual(['status', 'tags', 'done', 'count', 'due', 'paper'])
  })

  test('each hold the control its value asks for', () => {
    const html = drawn(NOTE)

    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    expect(html).toContain('type="number"')
    expect(html).toContain('type="date"')
    expect(html).toContain('<select')
    expect(html.match(/class="chip[ "]/g)).toHaveLength(2)
    expect(html).toContain('Properties<span>6</span>')
  })

  test('give a quoted value a text field, whatever it says', () => {
    // `'007'` is a zip code and `"true"` a word; a number field would write back 7.
    const html = drawn('---\nzip: \'007\'\nflag: "true"\n---\nWords.\n')

    expect(html).not.toContain('type="number"')
    expect(html).not.toContain('type="checkbox"')
    expect(html).toContain('value="007"')
  })

  test('offer a way to add one, at their foot', () => {
    expect(drawn(NOTE)).toContain('Add a property')
    expect(drawn('Words with no front matter.\n')).toContain('Add a property')
  })
})

describe('a block nib cannot read', () => {
  test('is shown as it is written, and not guessed at as rows', () => {
    const html = drawn('---\n# a comment\nstatus: draft\n---\nWords.\n')

    expect(html).toContain('class="yaml')
    expect(html).toContain('# a comment')
    expect(html).not.toContain('data-key=')
    expect(html).not.toContain('Add a property')
  })
})

/** A tab of a kind nothing else opens is a note tab too: `.json`, `.css`, `.txt` and
 *  code all open as one. Front matter is Markdown's, and a block of YAML put on top of
 *  any of those is a file that no longer parses as what it is. */
describe('a file that is not Markdown', () => {
  test('is offered no way to add a property', () => {
    expect(drawn('{ "a": 1 }\n', '/space/data.json')).not.toContain('Add a property')
    expect(drawn('Plain words.\n', '/space/notes.txt')).not.toContain('Add a property')
  })

  test('while a Markdown note is', () => {
    expect(drawn('Words.\n', '/space/Note.md')).toContain('Add a property')
  })
})

describe('a note that may not be written', () => {
  test('is read, with nothing to press', () => {
    modes.readOnly = true
    const html = drawn('---\ntags: [a]\nstatus: x\n---\n')
    modes.readOnly = false

    expect(html).toContain('data-key="status"')
    expect(html).not.toContain('Add a property')
    expect(html).not.toContain('chip-off')
    expect(html).toContain('readonly')
  })
})
