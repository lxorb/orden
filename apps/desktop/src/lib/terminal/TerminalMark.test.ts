import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** A terminal's one mark (#1110): the icon chosen for it over what runs in it - an online
 *  terminal's in its file, a local one's in its tab's words - with an online one's cloud
 *  still in the corner; and the same mark on its row as on its tab, since FileMark draws
 *  an online terminal's file with this. */

const chosen: Record<string, string | null> = {}

vi.mock('../chosen-icon', () => ({
  chosenIcon: (path: string) => chosen[path] ?? null,
  chosenTint: () => null,
}))

const TerminalMark = (await import('./TerminalMark.svelte')).default
const { writeSpec } = await import('./spec')

const drawn = (tab: { doc: string; path?: string | null; id?: string }) =>
  render(TerminalMark, { props: { tab: { running: null, ...tab } } }).body

describe('a terminal’s mark', () => {
  test('an online terminal wears the icon its file chose, under its cloud', () => {
    chosen['/s/Server.term'] = '🚀'
    const body = drawn({ doc: '', path: '/s/Server.term' })
    expect(body).toContain('🚀')
    expect(body).toContain('class="cloud')
    // A row with no tab open has asked nothing of the machine.
    expect(body).not.toContain('class="state')
  })

  test('one on this machine wears the icon its words chose, and its shell’s without', () => {
    const spec = { shell: 'pwsh', folder: null, key: 'k', name: null }
    expect(drawn({ doc: writeSpec({ ...spec, icon: '🐙' }) })).toContain('🐙')
    const plain = drawn({ doc: writeSpec(spec) })
    expect(plain).not.toContain('🐙')
    expect(plain).not.toContain('class="cloud')
  })
})
