import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

interface Component {
  name: string
  text: string
  style: string
}

const components: Component[] = componentFiles(SOURCE).map((path) => {
  const text = readFileSync(path, 'utf8')
  return {
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text,
    style: [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n'),
  }
})

function named(name: string): Component {
  const found = components.find((one) => one.name === name)
  if (!found) throw new Error(`${name} is not there any more`)
  return found
}

function declarations(style: string): string {
  return style.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('a mark that fills the box it was given', () => {
  test('is taken out of the line box it would otherwise sit in', () => {
    const style = declarations(named('lib/Icon.svelte').style)
    const glyph = /\.glyph\s*\{([^}]*)\}/.exec(style)?.[1] ?? ''

    expect(glyph).toMatch(/display\s*:\s*block/)
    expect(glyph).toMatch(/width\s*:\s*100%/)
    expect(glyph).toMatch(/height\s*:\s*100%/)
  })

  test('and the title bar names no space of its own', () => {
    const bar = named('lib/Titlebar.svelte')
    expect(bar.text).not.toContain('<SpaceSwitcher')
    expect(bar.text).not.toContain('<SpaceMark')
    expect(bar.text).not.toContain('{space.name}')
  })

  test('and so does the space named over the file list, out of the one badge', () => {
    const switcher = named('lib/SpaceSwitcher.svelte')
    const badge = named('lib/SpaceBadge.svelte')
    const row = named('lib/SpaceRow.svelte')

    expect(badge.text.match(/<SpaceMark /g)).toHaveLength(1)
    expect(badge.text).toMatch(/class="orden-badge"[\s\S]{0,200}<SpaceMark/)
    expect(switcher.text).not.toContain('<SpaceMark ')
    expect(switcher.text.match(/<SpaceBadge /g)).toHaveLength(1)
    expect(row.text.match(/<SpaceBadge /g)).toHaveLength(1)
    expect(switcher.text.match(/\{@render mark\(\)/g)).toHaveLength(2)
  })

  test('and the chevron beside it is stroked in its own ink, not filled in black', () => {
    const style = declarations(named('lib/SpaceSwitcher.svelte').style)
    const chevron = /\.chevron\s*\{([^}]*)\}/.exec(style)?.[1] ?? ''

    expect(chevron).toMatch(/fill\s*:\s*none/)
    expect(chevron).toMatch(/stroke\s*:\s*currentColor/)
    expect(chevron).toMatch(/color\s*:\s*var\(--muted\)/)
  })
})

describe('the mark that says shared', () => {
  test('is drawn in one component and nowhere else', () => {
    const drawn = components
      .filter((one) => /lucide\/dist\/esm\/icons\/(users|share-2)\.mjs/.test(one.text))
      .map((one) => one.name)

    expect(drawn).toEqual(['lib/SharedMark.svelte'])
  })

  test('is small and quiet, which is what a mark beside a name is', () => {
    const style = declarations(named('lib/SharedMark.svelte').style)
    expect(style).toMatch(/color\s*:\s*var\(--muted\)/)
    expect(style).toMatch(/width\s*:\s*var\(--icon-sm\)/)
  })

  test('and says it in a word as well, for a reader who cannot see it', () => {
    expect(named('lib/SharedMark.svelte').text).toMatch(/aria-label=\{label\}/)
    expect(named('lib/SharedMark.svelte').text).toMatch(/'Shared'/)
  })

  test('and nothing draws a dot for it any more', () => {
    const dots = components
      .filter((one) => {
        const style = declarations(one.style)
        return [...style.matchAll(/\{([^}]*)\}/g)].some((rule) => {
          const body = rule[1] ?? ''
          return (
            /border-radius\s*:\s*50%/.test(body) &&
            /background\s*:\s*var\(--accent\)/.test(body) &&
            /width\s*:\s*[0-9]px/.test(body)
          )
        })
      })
      .map((one) => one.name)
      .sort()

    expect(dots).toEqual([
      'lib/JoinPending.svelte',
      'lib/JoinSheet.svelte',
      'lib/Tabs.svelte',
      'lib/ai/UnreadDot.svelte',
    ])
  })

  test('and the file list says it on the note itself', () => {
    const tree = named('lib/Tree.svelte')
    expect(tree.text).toContain("import SharedMark from './SharedMark.svelte'")
    expect(tree.text.match(/<SharedMark /g)).toHaveLength(2)
    expect(tree.text).toContain('othersIn(')
    expect(tree.text).toContain('isSharedItem(')
  })

  test('and the switcher says it with the mark instead', () => {
    const switcher = named('lib/SpaceSwitcher.svelte')
    const row = named('lib/SpaceRow.svelte')
    expect(switcher.text).toContain("import SharedMark from './SharedMark.svelte'")
    expect(switcher.text.match(/<SharedMark \/>/g)).toHaveLength(1)
    expect(row.text.match(/<SharedMark \/>/g)).toHaveLength(1)
    expect(row.text).toContain('<SharedMark icon={Eye} label="Read-only" />')
    expect(declarations(switcher.style)).not.toMatch(/\.with\b/)
  })
})

describe('the sidebar button', () => {
  test('is one glyph, drawn one way in both states', () => {
    const style = declarations(named('lib/SidebarToggle.svelte').style)
    const edge = [...style.matchAll(/\.edge\s*\{([^}]*)\}|\.edge[^{]*\{([^}]*)\}/g)]
      .map((one) => one[1] ?? one[2] ?? '')
      .join(';')

    expect(edge).not.toMatch(/opacity/)
    expect(edge).not.toMatch(/transform/)
  })

  test('and nothing in the component picks a second drawing by state', () => {
    const text = named('lib/SidebarToggle.svelte').text
    expect(text.match(/<svg/g)).toHaveLength(1)
    expect(text).not.toMatch(/\{#if[^}]*open[^}]*\}[\s\S]{0,200}<svg/)
  })
})

describe('the row across the top of the app', () => {
  test('is the header height', () => {
    const style = declarations(named('lib/Titlebar.svelte').style)
    expect(style).toMatch(/height\s*:\s*var\(--header-height\)/)
  })
})
