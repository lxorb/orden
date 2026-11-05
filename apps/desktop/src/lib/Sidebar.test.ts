import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'
import { STARTS_RIGHT } from './workspace/panels'

/** What the sidebar draws: which tabs its strip holds, what the Outline makes
 *  of a note's footnotes, and who is offered the button that holds a panel on one note.
 *
 *  Rendered on the server, the way Tabs.test does beside it: what is under test is the
 *  markup, and the markup is what a reader gets. The stores are driven by hand and the
 *  two that reach a network or a `ResizeObserver` are stood in for.
 *
 *  The hold had no test at all, which is how it came to be offered on a phone while the
 *  code said it was not and the docs said it was not either. */

vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, following: null } }))
vi.mock('./surfaces.svelte', () => ({
  askPanel: () => new Promise(() => undefined),
  linksPanel: () => new Promise(() => undefined),
  pagesNavigator: () => new Promise(() => undefined),
  searchPanel: () => new Promise(() => undefined),
  showFeedback: () => undefined,
  toggleTabOverview: () => undefined,
}))

const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')
const { agentMarks } = await import('./agent-marks.svelte')
const Sidebar = (await import('./Sidebar.svelte')).default

/** A space with one note open, which is what a panel about a note needs. */
function open(text: string) {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('A note', text)
}

function drawn(
  panel: Parameters<typeof workspace.showPanel>[0],
  device: typeof viewport.device = 'desktop',
) {
  viewport.device = device
  // Written rather than asked for: what these tests are about is the strip as it is
  // drawn for a panel, not the gesture that got there.
  workspace.panel = panel
  return render(Sidebar, { props: { side: 'left' as const } }).body
}

describe('the panel tabs', () => {
  /** The labels of one side's strip, in the order it draws them. */
  function strip(side: 'left' | 'right'): string[] {
    viewport.device = 'desktop'
    workspace.panel = 'tree'
    workspace.rightPanel = 'outline'
    const html = render(Sidebar, { props: { side } }).body
    workspace.rightPanel = null
    return [...html.matchAll(/role="tab"[^>]*aria-label="([^"]+)"/g)].map(([, one]) => one ?? '')
  }

  test('are the space on the left and the note in front on the right, as Obsidian has them', () => {
    open('# Head\n')

    // The Tasks panel lives on the right (#1047).
    expect(strip('left')).toEqual(['Files'])
    // And the scratchpad, the one tab on a desktop's right that is no panel (#1032).
    expect(strip('right')).toEqual(['Outline', 'Links', 'Ask', 'Tasks', 'Scratchpad'])
  })

  test('and a panel moved over is on the other side, at the end of its strip', () => {
    open('# Head\n')
    workspace.movePanel('outline', 'left')

    expect(strip('left')).toEqual(['Files', 'Outline'])
    expect(strip('right')).toEqual(['Links', 'Ask', 'Tasks', 'Scratchpad'])
    workspace.movePanel('outline', 'right')
    expect(strip('right')).toEqual(['Links', 'Ask', 'Tasks', 'Outline', 'Scratchpad'])
    workspace.right = [...STARTS_RIGHT]
  })

  /** The strip's row split at the end of the pill: what is in the one tablist, and
   *  what is after it. */
  function row(panel: Parameters<typeof workspace.showPanel>[0]) {
    viewport.device = 'desktop'
    workspace.rightPanel = panel
    const html = render(Sidebar, { props: { side: 'right' as const } }).body
    workspace.rightPanel = null

    const start = html.indexOf('role="tablist"')
    const end = html.indexOf('class="tools', start)
    const after = html.slice(end, html.indexOf('class="stack', end))
    return { pill: html.slice(start, end), after, html }
  }

  test('are every one of them in one pill, and nothing of the panel’s own is', () => {
    open('# Head\n')
    agentMarks.heard = true
    const { pill, after, html } = row('ask')
    agentMarks.heard = false

    // Emil's 840 px panel: its tabs, and the Ask panel's Chats beside them looking like
    // one more. All of them are tabs of the one list, and the scratchpad's with them
    // (#1032), and the Tasks panel's since it lives on the right (#1047); Chats is a tool
    // after it. Properties, Footnotes and Agents are no panels any more (#1120).
    expect(html.match(/role="tablist"/g)).toHaveLength(1)
    expect(pill.match(/role="tab"/g)).toHaveLength(5)
    expect(after).not.toContain('role="tab"')
    expect(after).toContain('aria-label="Chats"')
    expect(after).toContain('aria-label="New chat"')
    expect(pill).not.toContain('aria-label="Chats"')
  })

  test('and the panel’s tools come after the pill in one group, whichever panel', () => {
    open('# Head\n')

    for (const panel of ['outline', 'links', 'ask'] as const) {
      const { html } = row(panel)
      expect(html.match(/class="tools/g)).toHaveLength(1)
    }
  })

  /** The questions agents wait on are counted on the Ask tab, whose chat list is where
   *  an agent's session is and where they are answered (#1120). */
  test('and the Ask tab counts the questions agents are waiting on', () => {
    open('# Head\n')
    agentMarks.heard = true
    agentMarks.waiting = 2
    const { pill } = row('outline')
    agentMarks.waiting = 0
    agentMarks.heard = false

    expect(pill).toMatch(/aria-label="Ask"[\s\S]*?class="waiting[^"]*"[^>]*>\s*2\s*</)
    expect(pill).not.toContain('aria-label="Agents"')
  })

  test('and with nothing laid out yet, none is put behind More', () => {
    open('# Head\n')
    const { pill } = row('outline')

    expect(pill).not.toContain('aria-label="More"')
  })
})

/** The space's name is the head's one control, and the panel tabs are the only row
 *  between it and the list. */
describe('the head of the list', () => {
  /** A "Search this space" field stood under the tabs, and the owner asked for it
   *  gone (issue #230): search is its key, the palette, the app menu and, on a
   *  phone, the pull, each opening the Search panel with its own field. */
  test('has no search field over the list and no search tab, on a desktop or a phone', () => {
    open('# Head\n')

    for (const device of ['desktop', 'phone'] as const) {
      const html = drawn('tree', device)

      expect(html, device).not.toContain('Search this space')
      expect(html, device).not.toContain('data-region="search"')
      expect(html, device).not.toMatch(/class="hunt\b/)
      expect(html, device).not.toMatch(/role="tab"[^>]*aria-label="Search"/)
    }
  })

  /** A pen beside the space's name made a note, and the owner asked for it gone
   *  (issue #229): a new note is its key, the palette, the file list's menu and the
   *  new tab's chooser. The head is the switcher and, in a drawer, the sidebar button. */
  test('has no new note button beside the space, on a desktop or a phone', () => {
    open('# Head\n')

    for (const device of ['desktop', 'phone'] as const) {
      const html = drawn('tree', device)
      const start = html.indexOf('data-region="space"')
      const head = html.slice(start, html.indexOf('class="switch', start))

      expect(start, device).toBeGreaterThan(-1)
      expect(head, device).not.toContain('New note')
      expect(head, device).not.toMatch(/class="new\b/)
    }
  })
})

/** The Outline is offered beside what has parts to list, and nothing else (#1120); the
 *  table that says so is panel-tab.ts. */
describe('the Outline', () => {
  const NOTE = 'A claim[^1] and another[^two].\n\n[^1]: the first\n\n[^two]: the second\n'

  /** The right side, where the Outline lives, drawn on it. */
  function right(): string {
    viewport.device = 'desktop'
    workspace.rightPanel = 'outline'
    const html = render(Sidebar, { props: { side: 'right' as const } }).body
    workspace.rightPanel = null
    return html
  }

  test('ends on a Footnotes group, a row a footnote, under the headings', () => {
    open(`# Head\n\n${NOTE}`)
    const html = right()

    expect(html).toContain('the first')
    expect(html).toContain('Footnotes<span>2</span>')
    expect(html.indexOf('Head')).toBeLessThan(html.indexOf('Footnotes<span>'))
  })

  test('is a tab beside a note with footnotes and no headings', () => {
    open(NOTE)
    expect(right()).toMatch(/role="tab"[^>]*aria-label="Outline"/)
  })

  test('is no tab beside a note with neither, and the side shows its next panel', () => {
    open('Words, and nothing else.\n')
    viewport.device = 'desktop'
    workspace.rightPanel = 'outline'
    const html = render(Sidebar, { props: { side: 'right' as const } }).body

    expect(html).not.toMatch(/role="tab"[^>]*aria-label="Outline"/)
    expect(html).toContain('data-panel="links"')
    // What was chosen is kept, for the next note that has parts.
    expect(workspace.rightPanel).toBe('outline')
    workspace.rightPanel = null
  })
})

/** The button that holds a panel on one note while another is written beside it.
 *
 *  A handheld holds one document, so there is nothing to hold a panel against and
 *  opening another note closes the tab it would have been held on. The docs say it is
 *  not offered there; this is what makes that true rather than claimed. */
describe('the button that holds a panel on a note', () => {
  const HELD = 'Stay on this note'

  test('is offered on the two panels that are about one note', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links'] as const) {
      expect(drawn(panel), panel).toContain(HELD)
    }
  })

  test('and on none of the three that are about the space', () => {
    open('# Head\n')

    for (const panel of ['tree', 'search', 'ask'] as const) {
      expect(drawn(panel), panel).not.toContain(HELD)
    }
  })

  test('is not offered on a phone, which holds one document', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links'] as const) {
      expect(drawn(panel, 'phone'), panel).not.toContain(HELD)
    }
  })

  /** A handheld is the machine, not the size of the window: `deviceFor` asks the width
   *  only once a finger and a mobile user agent have already said it is a handheld, so a
   *  desktop window narrowed to the width of a phone stays a desktop and still has two
   *  panes to hold a panel between. Which is what the docs say, and - since nothing
   *  tested it - what an audit reading a narrow window as a phone would have called a
   *  bug. See viewport.svelte.ts and docs/mobile.md. */
  test('which is the machine and not the width, so a narrow window keeps it', () => {
    open('# Head\n')

    const html = drawn('outline', 'desktop')

    expect(viewport.touch).toBe(false)
    expect(html).toContain(HELD)
  })

  test('and the palette offers the same hold, by the same rule', async () => {
    const { appCommands } = await import('./commands')
    open('# Head\n')

    viewport.device = 'desktop'
    workspace.panel = 'links'
    const desktop = appCommands().find((one) => one.id === 'hold-panel')
    expect(desktop?.label).toBe(HELD)
    expect(desktop?.disabled).toBe(false)

    // Nothing to hold: a panel that is about the space, and then a handheld.
    workspace.panel = 'tree'
    expect(appCommands().find((one) => one.id === 'hold-panel')?.disabled).toBe(true)

    workspace.panel = 'outline'
    viewport.device = 'phone'
    expect(appCommands().find((one) => one.id === 'hold-panel')?.disabled).toBe(true)
    viewport.device = 'desktop'
  })

  test('nor on a tablet, which holds one document too', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links'] as const) {
      expect(drawn(panel, 'tablet'), panel).not.toContain(HELD)
    }
  })
})

/** The space in the panel's header, which is the list of spaces shut.
 *
 *  A space is named with its mark everywhere else it is named - its row in the
 *  switcher, the tab card - and the header over the file
 *  list is where it is named most. That header said the word alone, so the one place
 *  a space is always written was the one place it was never drawn. Emil: *"in the top
 *  left in the space select, you should see the icon of the current space."*
 *
 *  Asked with emoji, which are the one kind of icon that needs no set fetched: the
 *  platform's own colour font is already here. Which icon a space wears, and the
 *  letter it falls back to wherever the drawing cannot be had, is SpaceMark.test.ts
 *  beside this one. */
describe('the space in the header', () => {
  /** Two spaces, each with a mark of its own, the first of them open. */
  function two() {
    open('# Head\n')
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/work' },
      { id: 'play', name: 'Play', root: '/play' },
    ]
    workspace.applyIcon('/work', '📓')
    workspace.applyIcon('/play', '🚀')
    workspace.activeSpaceId = 'work'
  }

  test('wears the mark of the space you are in, in front of its name', () => {
    two()
    const html = drawn('tree')

    expect(html).toContain('📓')
    // In the badge every surface that names a space puts its mark in, rather than
    // loose beside the word where a letter would read as part of the name.
    expect(html).toMatch(/class="nib-badge[^"]*"[^>]*>[\s\S]{0,300}📓/)
    // And in front of the name: the first label in the panel is the header's own.
    expect(html.indexOf('📓')).toBeLessThan(html.indexOf('nib-row-label'))
  })

  test('and the mark changes with the space', () => {
    two()
    expect(drawn('tree')).not.toContain('🚀')

    workspace.activeSpaceId = 'play'
    const html = drawn('tree')

    expect(html).toContain('🚀')
    expect(html).not.toContain('📓')
  })

  /** What a reader who dresses a space in Settings sees: the header is drawn from
   *  what the space wears rather than from a copy taken when it was opened. */
  test('and follows the icon the space is given', () => {
    two()
    workspace.applyIcon('/work', '📌')
    const html = drawn('tree')

    expect(html).toContain('📌')
    expect(html).not.toContain('📓')
  })
})

/** Emil: the sidebar opened and shut in steps, "CHUCK CHUCK". The panel was built in
 *  the frame it was opened in and thrown away when it shut, and its own width was what
 *  slid, so every row was laid out again on every frame. Now it is built once and kept,
 *  and only the column it stands in opens and closes over it; see `.column`. */
describe('a shut side', () => {
  test('keeps its panel, rows and all, behind a closed column nothing can reach', () => {
    open('A claim[^1].\n\n[^1]: the first\n')
    workspace.panel = 'outline'
    workspace.closePanel()
    const html = render(Sidebar, { props: { side: 'left' as const } }).body

    expect(html).toMatch(/class="column[^"]*\bshut\b[^"]*"[^>]*\binert\b/)
    expect(html).toContain('<aside')
  })

  test('and an open one is the same column, open and reachable', () => {
    open('# Head\n')
    const html = drawn('tree')

    expect(html).toMatch(/class="column[^"]*"/)
    expect(html).not.toMatch(/class="column[^"]*\bshut\b/)
    expect(html).not.toMatch(/class="column[^"]*"[^>]*\binert\b/)
  })

  test('on the right is built on the panel it would open on, never the file list', () => {
    open('# Head\n')
    workspace.rightPanel = null
    workspace.lastRight = null
    const html = render(Sidebar, { props: { side: 'right' as const } }).body

    expect(html).toContain(`data-panel="${workspace.nextRight}"`)
    expect(html).not.toContain('data-panel="tree"')
  })
})

/** Two regions of one page with one name are two a reader cannot tell apart (#523). */
describe('the two sides', () => {
  test('have a name each', () => {
    open('# Head\n')
    const named = (side: 'left' | 'right') =>
      /<aside[^>]*aria-label="([^"]+)"/.exec(render(Sidebar, { props: { side } }).body)?.[1]

    expect(named('left')).toBe('Space panel')
    expect(named('right')).toBe('Right sidebar')
  })
})

/** A phone and a tablet have no AI panel (#403): not its tab on the right, not a way to
 *  it from the palette or a key, and not a panel left open on it by a sitting before. */
describe('the AI panel on a phone and a tablet', () => {
  function rightTabs(device: typeof viewport.device): string[] {
    viewport.device = device
    workspace.panel = null
    workspace.rightPanel = 'outline'
    const html = render(Sidebar, { props: { side: 'right' as const } }).body
    workspace.rightPanel = null
    viewport.device = 'desktop'
    return [...html.matchAll(/role="tab"[^>]*aria-label="([^"]+)"/g)].map(([, one]) => one ?? '')
  }

  test('has no tab on the right, where a desktop keeps one', () => {
    open('# Head\n')

    expect(rightTabs('desktop')).toContain('Ask')
    expect(rightTabs('phone')).not.toContain('Ask')
    expect(rightTabs('tablet')).not.toContain('Ask')
  })

  test('and asking for it shows nothing, while a desktop opens it', () => {
    open('# Head\n')
    workspace.rightPanel = null

    viewport.device = 'phone'
    workspace.showPanel('ask')
    expect(workspace.rightPanel).toBeNull()
    workspace.togglePanel('ask')
    expect(workspace.rightPanel).toBeNull()
    expect(workspace.offers('ask')).toBe(false)
    expect(workspace.offers('outline')).toBe(true)

    viewport.device = 'desktop'
    workspace.showPanel('ask')
    expect(workspace.rightPanel).toBe('ask')
    workspace.rightPanel = null
  })

  test('and one left open by a desktop sitting is not drawn, nor what the side opens on', () => {
    open('# Head\n')
    workspace.rightPanel = 'ask'
    workspace.lastRight = 'ask'

    viewport.device = 'phone'
    expect(workspace.openOn('right')).toBeNull()
    expect(workspace.nextRight).not.toBe('ask')

    viewport.device = 'desktop'
    expect(workspace.openOn('right')).toBe('ask')
    workspace.rightPanel = null
  })

  test('and the palette has no row for it', async () => {
    const { appCommands } = await import('./commands')
    open('# Head\n')

    viewport.device = 'desktop'
    expect(appCommands().some((one) => one.id === 'ask-panel')).toBe(true)
    viewport.device = 'phone'
    expect(appCommands().some((one) => one.id === 'ask-panel')).toBe(false)
    viewport.device = 'desktop'
  })
})
