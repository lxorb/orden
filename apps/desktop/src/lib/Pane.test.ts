import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { conversationKey } from './chats/conversation-key'
import { TAB_KINDS } from './workspace/tab-kinds'

/** What fills a pane is fetched the first time a tab of its kind is in front: a
 *  canvas, a set of pages, a website, the reading view, the buttons of an empty pane. A fetch
 *  can fail - in the browser build the site is deployed again under a tab that stayed
 *  open, and the chunk it names is gone - and a surface whose fetch failed drew
 *  nothing at all: a blank pane, no word, and nothing that would ever fill it, because
 *  the door keeps its answer. A browser that cannot reach a page says so and offers
 *  Reload; so does a pane.
 *
 *  Read out of the component rather than mounted: a pane is the whole app's graph, and
 *  what is asked here is only that no surface block is left without its other half. */

const SOURCE = readFileSync(fileURLToPath(new URL('./Pane.svelte', import.meta.url)), 'utf8')

const SURFACES = [...SOURCE.matchAll(/\{#await (\w+Surface)\(\) then \w+\}([\s\S]*?)\{\/await\}/g)]

describe('a surface a pane is filled with', () => {
  test('is every kind of tab a pane can show', () => {
    expect(SURFACES.map(([, door]) => door).sort()).toEqual([
      'applicationSurface',
      'canvasSurface',
      'chatSurface',
      'conversationSurface',
      'emptySurface',
      'explorerSurface',
      'graphSurface',
      'pagesSurface',
      // No paper of its own: a PDF opens as the page note that holds it, which the
      // pages surface draws with the paper behind it. See `openPdf` in
      // workspace.svelte.ts.
      'readingSurface',
      'terminalSurface',
      'viewSurface',
      'webSurface',
    ])
  })

  test("tells another service's conversation by the words its tab is opened with", () => {
    const surfaces = readFileSync(
      fileURLToPath(new URL('./surfaces.svelte.ts', import.meta.url)),
      'utf8',
    )
    const key = conversationKey({ provider: 'mail', account: 'a', conversation: 'c' })
    const head = key.slice(0, key.indexOf('\n'))
    expect(surfaces).toContain(`words.startsWith('${head}\\n')`)
  })

  test('offers a reload where it could not be fetched, rather than a blank pane', () => {
    for (const [, door, body] of SURFACES) {
      expect(body, door).toMatch(/\{:catch\}\s*\{@render unreachable\(\)\}/)
    }
  })
})

/** The kinds the pane draws a surface of its own for, by the branches that ask for one. */
const OWN_SURFACES = [...SOURCE.matchAll(/\{:else if tab\?\.kind === '(\w+)'\}/g)].map(
  ([, kind]) => kind as keyof typeof TAB_KINDS,
)

/** A kind with a surface of its own is not the editor, which is what the pane asks
 *  before it takes a dropped note as a link and before it draws the editor's find bar.
 *  The chat in a tab was the one left out (#385). */
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
