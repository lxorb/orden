import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { conversationKey } from './chats/conversation-key'
import { isRemote } from './chats/remotes'
import { TAB_KINDS } from './workspace/tab-kinds'

const SOURCE = readFileSync(join(import.meta.dirname, './Pane.svelte'), 'utf8')

const SURFACES = [...SOURCE.matchAll(/\{#await (\w+Surface)\(\) then \w+\}([\s\S]*?)\{\/await\}/g)]

describe('a surface a pane is filled with', () => {
  test('is every kind of tab a pane can show', () => {
    expect(SURFACES.map(([, door]) => door).sort()).toEqual([
      'applicationSurface',
      'canvasSurface',
      'chatSurface',
      'emptySurface',
      'explorerSurface',
      'graphSurface',
      'pagesSurface',
      'passSurface',
      'readingSurface',
      'terminalSurface',
      'timeSurface',
      'viewSurface',
      'webSurface',
    ])
  })

  test("opens another service's conversation in the one chat surface, not a second one", () => {
    const key = conversationKey({ provider: 'mail', account: 'a', conversation: 'c' })
    expect(isRemote(key)).toBe(true)
    expect(isRemote('/spaces/Team/General.chat')).toBe(false)
    expect(SOURCE).not.toContain('ConversationTab')
  })

  test('offers a reload where it could not be fetched, rather than a blank pane', () => {
    for (const [, door, body] of SURFACES) {
      expect(body, door).toMatch(/\{:catch\}\s*\{@render unreachable\(\)\}/)
    }
  })
})

const OWN_SURFACES = [...SOURCE.matchAll(/\{:else if tab\?\.kind === '(\w+)'\}/g)].map(
  ([, kind]) => kind as keyof typeof TAB_KINDS,
)

describe('a kind with a surface of its own', () => {
  test('is not the editor, so a note dropped in its middle is not taken as a link', () => {
    expect(OWN_SURFACES).toContain('channel')
    for (const kind of OWN_SURFACES) expect(TAB_KINDS[kind].editor, kind).toBe(false)
    expect(SOURCE).toMatch(/const writing = \$derived\(!!tab && TAB_KINDS\[tab\.kind\]\.editor/)
    expect(SOURCE).toMatch(/const keepsMiddle = \$derived\(\s*ownSurface \|\| \(writing &&/)
  })

  test("has no editor's find bar drawn over it", () => {
    expect(TAB_KINDS.channel.editor).toBe(false)
    expect(SOURCE).toContain('<Door open={finding && writing} load={() => findBar()}>')
  })
})

describe('a protected tab', () => {
  test('is drawn as its lock before any surface or the editor', () => {
    const chain = SOURCE.slice(SOURCE.indexOf('{#if tab?.path && locked}'))
    expect(chain.length).toBeLessThan(SOURCE.length)
    for (const [, door] of SURFACES) {
      expect(chain.indexOf(`${door}()`), door).toBeGreaterThan(0)
    }
    expect(chain.indexOf('<Editor')).toBeGreaterThan(0)
    expect(SOURCE).toContain('const locked = $derived(workspace.protection.locked(tab?.path))')
  })

  test('is never a column beside an open one, and has no find bar', () => {
    expect(SOURCE).toMatch(
      /one\.kind === 'note' && !one\.reading && !workspace\.protection\.locked\(one\.path\)/,
    )
    expect(SOURCE).toMatch(/const writing = \$derived\([^)]*&& !locked\)/)
  })
})
