import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'
import { STARTS_RIGHT } from './workspace/panels'

vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, following: null } }))
vi.mock('./surfaces.svelte', () => ({
  askPanel: () => new Promise(() => undefined),
  linksPanel: () => new Promise(() => undefined),
  pagesNavigator: () => new Promise(() => undefined),
  searchPanel: () => new Promise(() => undefined),
  tasksPanel: () => new Promise(() => undefined),
  phoneTabsBar: () => new Promise(() => undefined),
  phoneYou: () => new Promise(() => undefined),
  showFeedback: () => undefined,
  toggleTabOverview: () => undefined,
  tabOverview: { open: false },
}))

const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')
const { agentMarks } = await import('./agent-marks.svelte')
const { hiddenKinds, TIME_WORD } = await import('./settings.svelte')
const Sidebar = (await import('./Sidebar.svelte')).default
const PhoneTabs = (await import('./phone/PhoneTabs.svelte')).default
const PhoneYou = (await import('./phone/PhoneYou.svelte')).default

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
  workspace.panel = panel
  return render(Sidebar, { props: { side: 'left' as const } }).body
}

describe('the panel tabs', () => {
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

    expect(strip('left')).toEqual(['Files'])
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

  test('hold the time tracker only once Settings turns it on', () => {
    hiddenKinds.hidden = [TIME_WORD]
    expect(strip('left')).toEqual(['Files', 'Time tracker'])
    hiddenKinds.hidden = []
    expect(strip('left')).toEqual(['Files'])
  })

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

describe('the head of the list', () => {
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

describe('the Outline', () => {
  const NOTE = 'A claim[^1] and another[^two].\n\n[^1]: the first\n\n[^two]: the second\n'

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
    expect(workspace.rightPanel).toBe('outline')
    workspace.rightPanel = null
  })
})

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

describe('the space in the header', () => {
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
    expect(html).toMatch(/class="orden-badge[^"]*"[^>]*>[\s\S]{0,300}📓/)
    expect(html.indexOf('📓')).toBeLessThan(html.indexOf('orden-row-label'))
  })

  test('and the mark changes with the space', () => {
    two()
    expect(drawn('tree')).not.toContain('🚀')

    workspace.activeSpaceId = 'play'
    const html = drawn('tree')

    expect(html).toContain('🚀')
    expect(html).not.toContain('📓')
  })

  test('and follows the icon the space is given', () => {
    two()
    workspace.applyIcon('/work', '📌')
    const html = drawn('tree')

    expect(html).toContain('📌')
    expect(html).not.toContain('📓')
  })
})

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

describe('a shut side beside an open one', () => {
  test('is not built on the panel the other side has open, so it is not drawn twice', () => {
    open('# Head\n\n## Two\n')
    workspace.rightPanel = null
    workspace.lastRight = 'outline'
    workspace.panel = 'outline'
    const html = render(Sidebar, { props: { side: 'right' as const } }).body
    workspace.panel = null

    expect(html).toContain('data-panel=')
    expect(html).not.toContain('data-panel="outline"')
  })

  test('and an open side draws its panel whatever the other side shows', () => {
    open('# Head\n\n## Two\n')
    workspace.rightPanel = 'outline'
    workspace.panel = 'outline'
    const html = render(Sidebar, { props: { side: 'right' as const } }).body
    workspace.panel = null
    workspace.rightPanel = null

    expect(html).toContain('data-panel="outline"')
  })
})

describe('the two sides', () => {
  test('have a name each', () => {
    open('# Head\n')
    const named = (side: 'left' | 'right') =>
      /<aside[^>]*aria-label="([^"]+)"/.exec(render(Sidebar, { props: { side } }).body)?.[1]

    expect(named('left')).toBe('Space panel')
    expect(named('right')).toBe('Right sidebar')
  })
})

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

describe('the tab bar on a phone', () => {
  function bar(panel: Parameters<typeof workspace.showPanel>[0]) {
    viewport.device = 'phone'
    workspace.panel = panel
    const html = render(PhoneTabs).body
    viewport.device = 'desktop'
    return {
      tabs: [...html.matchAll(/data-tab="([a-z]+)"/g)].map(([, one]) => one ?? ''),
      on: /data-tab="([a-z]+)"[^>]*aria-current="page"/.exec(html)?.[1] ?? null,
    }
  }

  const strip = (device: typeof viewport.device) => {
    const html = drawn('tree', device)
    viewport.device = 'desktop'
    return html.includes('role="tablist"')
  }

  test('stands in for the panel strip on a phone, and only there', () => {
    open('# Head\n')

    expect(bar('tree')).toEqual({ tabs: ['tree', 'tasks', 'search'], on: 'tree' })
    expect(strip('phone')).toBe(false)
    expect(strip('desktop')).toBe(true)
    expect(strip('tablet')).toBe(true)
  })

  test('shows tasks full screen on the left, where a desktop keeps them on the right', () => {
    open('# Head\n')
    workspace.panel = null
    workspace.rightPanel = null

    viewport.device = 'phone'
    workspace.showPanel('tasks')
    expect([workspace.panel, workspace.rightPanel]).toEqual(['tasks', null])
    expect(workspace.sideOf('tasks')).toBe('left')
    expect(bar('tasks').on).toBe('tasks')

    viewport.device = 'desktop'
    workspace.panel = null
    workspace.showPanel('tasks')
    expect([workspace.panel, workspace.rightPanel]).toEqual([null, 'tasks'])
    expect(workspace.right).toContain('tasks')
    workspace.rightPanel = null
  })

  test('and back from a note returns to the tab it was opened from', () => {
    open('# Head\n')
    viewport.device = 'phone'
    workspace.showPanel('search')
    workspace.closePanel()
    expect(workspace.panel).toBeNull()

    workspace.toggleSidebar()
    expect(workspace.panel).toBe('search')

    viewport.device = 'desktop'
    workspace.closePanel()
    workspace.toggleSidebar()
    expect(workspace.panel).toBe('tree')
    workspace.panel = null
  })
})

describe('the head of a phone screen', () => {
  test("holds the reader's own button, where a desktop and a tablet keep a foot", () => {
    open('# Head\n')

    expect(drawn('tree', 'phone')).not.toContain('data-region="foot"')
    for (const device of ['desktop', 'tablet'] as const) {
      expect(drawn('tree', device), device).toContain('data-region="foot"')
    }
    viewport.device = 'desktop'

    const you = render(PhoneYou).body
    expect(you).toContain('data-phone-you')
    expect(you).toContain('aria-label="Sign in"')
    expect(you).toContain('aria-haspopup="menu"')
  })

  test('and the new note button stands on the notes alone, over the tab bar', () => {
    open('# Head\n')
    viewport.device = 'phone'

    workspace.panel = 'tree'
    expect(render(PhoneTabs).body).toContain('aria-label="New note"')
    for (const panel of ['tasks', 'search'] as const) {
      workspace.panel = panel
      expect(render(PhoneTabs).body, panel).not.toContain('aria-label="New note"')
    }
    viewport.device = 'desktop'
    workspace.panel = null
  })
})
