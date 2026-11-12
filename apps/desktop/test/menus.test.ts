import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

function componentSources(): string[] {
  const out: string[] = []

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte')) out.push(readFileSync(path, 'utf8'))
    }
  }

  walk(SOURCE)
  return out
}

function body(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n  }', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

function moduleBody(text: string, signature: string): string {
  const from = text.indexOf(signature)
  expect(from, `no ${signature}`).toBeGreaterThanOrEqual(0)

  const to = text.indexOf('\n}', from)
  expect(to, `${signature} is never closed`).toBeGreaterThan(from)

  return text.slice(from, to)
}

describe('what a space offers', () => {
  const space = moduleBody(read('lib/space-actions.ts'), 'export function spaceMenu(space: Space)')

  test('the space itself: its name, its mark, who may reach it', () => {
    for (const entry of ["'Rename'", "'Choose an icon'", "'Share'", "'Publish'"]) {
      expect(space, entry).toContain(entry)
    }
  })

  test('publishing stands next to sharing', () => {
    const share = space.indexOf("'Share'")
    const publish = space.indexOf("'Publish'")

    expect(publish).toBeGreaterThan(share)
    expect(space.slice(share, publish).match(/label:/g) ?? []).toHaveLength(1)
  })

  test('and not what to put in it, which is the file list', () => {
    expect(space).not.toContain("'New note'")
  })

  test('a shared space still offers the way out of it', () => {
    expect(space).toContain("'Leave space'")
  })

  test('and where it sits, as a step in each direction', () => {
    expect(space).toContain("'Move up'")
    expect(space).toContain("'Move down'")
  })

  test('but not for a space somebody else shared', () => {
    const nudge = moduleBody(
      read('lib/space-actions.ts'),
      'function canNudge(space: Space, by: -1 | 1): boolean',
    )

    expect(nudge).toContain("roleOf(space.root) !== 'owner'")
  })

  test('through the one menu the switcher opens, however it is asked for', () => {
    const switcher = read('lib/SpaceMenu.svelte')
    const rows = read('lib/SpaceList.svelte')

    expect(switcher).toContain('menu.show(event, spaceMenu(space)')
    expect(switcher).toContain('<SpaceList {typing} {choose} {about} />')
    expect(rows).toContain('oncontextmenu={(event) => about?.(event, space)}')
    expect(rows).toContain('use:longPress={(event) => about?.(event, space)}')
    expect(rows).toContain('<RowMore onclick={(event: MouseEvent) => about(event, space)} />')
  })
})

describe('the path a note sits at', () => {
  const everywhere = [
    ...componentSources(),
    read('lib/menu.svelte.ts'),
    read('lib/commands.ts'),
    read('lib/app-menu.ts'),
  ].join('\n')

  test('is not a row in any menu, on any device', () => {
    expect(everywhere).not.toContain("'Reveal in Explorer'")
    expect(everywhere).not.toContain("'Copy path'")
    expect(everywhere).not.toContain('revealEntry')
    expect(everywhere).not.toContain('copyPathEntry')
  })
})

describe('making a folder', () => {
  const everywhere = [
    ...componentSources(),
    read('lib/row-menu.ts'),
    read('lib/menu.svelte.ts'),
    read('lib/commands.ts'),
    read('lib/app-menu.ts'),
    read('lib/shortcuts/registry.ts')
      .split('\n')
      .filter((line) => !line.includes("['explorer."))
      .join('\n'),
  ].join('\n')

  test('is not offered anywhere, under any name', () => {
    expect(everywhere).not.toContain("'New folder'")
    expect(everywhere).not.toContain('createFolder')
  })

  test('and no row can be drawn as one but an empty note that holds notes', () => {
    const marks = read('lib/file-mark.ts')
    const byName = marks.slice(marks.indexOf('export function fileMark'))
    expect(byName.slice(0, byName.indexOf('\n}\n'))).not.toContain('folder')
    expect(everywhere).not.toContain("mark: 'folder'")
    expect(everywhere).not.toContain("'folder-open'")
  })
})

describe('what a row of the file list offers', () => {
  const tree = read('lib/Tree.svelte')
  const source = read('lib/row-menu.ts')
  const row = moduleBody(source, 'export function rowMenu(entry: Entry)')
  const entries = moduleBody(read('lib/menu.svelte.ts'), 'export function iconEntries(')

  test('its name, and where it goes', () => {
    for (const entry of ["'Rename'", 'moveEntry(entry)']) {
      expect(row, entry).toContain(entry)
    }
  })

  test('a note inside it, which is how a note comes to hold notes', () => {
    expect(row).toContain("'New note inside'")
    expect(row).toContain('workspace.createInside(entry.path)')
  })

  test('its icon, in the same words the rail uses for a space', () => {
    expect(row).toContain('iconEntries(marked.path, entry.is_dir && !own)')
    expect(entries).toContain("'Choose an icon'")
  })

  test('and the way back to no icon, only while it wears one', () => {
    expect(entries).toContain("'Remove icon'")
    expect(entries).toContain('chosenIcon(path) === null')
  })

  test('choosing opens the one picker there is', () => {
    expect(entries).toContain('iconChoice.file(path)')
    expect(entries).toContain('iconChoice.folder(path)')
  })

  test('on the note the row is drawn as, whichever that is', () => {
    expect(row).toContain('const marked = own ?? entry')
    expect(body(tree, 'function markPath(entry: Entry, own: Entry | null)')).toContain(
      'own?.path ?? entry.path',
    )
  })

  test('and deleting asks first where something is nested under it', () => {
    const removing = moduleBody(source, 'async function removeRow(')

    expect(removing).toContain('prompt.confirm')
    expect(removing).toContain("'The notes inside it go too.'")
    expect(removing).toContain('workspace.remove(entry.path, true)')
  })

  test('through the menu a pointer opens and the one a finger opens', () => {
    const drawn = tree.slice(tree.indexOf('data-path={entry.path}'))

    expect(drawn).toContain('oncontextmenu={(event) => showRowMenu(event, entry, name)}')
    expect(drawn).toContain('use:longPress={(event) => showRowMenu(event, entry, name)}')
  })

  test('and the menu is the row menu, fetched by the press', () => {
    const door = tree.slice(
      tree.indexOf('function showRowMenu('),
      tree.indexOf('function openRowAt('),
    )

    expect(door).toContain("import('./row-menu')")
    expect(door).toContain('menu.show(event, rowMenu(entry), { title })')
    expect(read('lib/surfaces.svelte.ts')).toContain("import('./row-menu')")
  })
})

describe("what the strip's empty stretch offers", () => {
  const tabs = read('lib/Tabs.svelte')
  const door = () => body(tabs, 'function showStripMenu(')

  test('the menu is the strip menu, fetched by the press', () => {
    expect(door()).toContain("import('./tab-strip/strip-menu')")
    expect(door()).toContain('menu.show(event, stripMenu(paneId))')
    expect(read('lib/surfaces.svelte.ts')).toContain("import('./tab-strip/strip-menu')")
  })

  test('asked for on the strip, and only where nothing else is under the point', () => {
    expect(tabs).toContain('oncontextmenu={showStripMenu}')
    expect(tabs).toContain('use:longPress={showStripMenu}')
    expect(door()).toContain('document.elementFromPoint(event.clientX, event.clientY) !== strip')
  })

  test('and the stretch stays the caption', () => {
    expect(tabs).toContain("data-tauri-drag-region={caption ? '' : undefined}")
  })
})

describe('what the plus in the tab strip offers', () => {
  const tabs = read('lib/Tabs.svelte')

  const plus = tabs.slice(
    tabs.indexOf('class="new"'),
    tabs.indexOf('</button>', tabs.indexOf('class="new"')),
  )

  test('a new tab, as Ctrl+T makes one, and no list of its own', () => {
    expect(plus).toContain('workspace.newTab(paneId)')
    expect(plus).not.toContain('aria-haspopup')
    expect(tabs).not.toContain('new-kinds')
    expect(tabs).not.toContain("'New canvas'")
  })

  test('a press is the new tab, with nothing hung from it', () => {
    expect(plus).toContain('onclick={() => workspace.newTab(paneId)}')
    expect(plus).not.toContain('oncontextmenu')
    expect(plus).not.toContain('longPress')
  })
})
