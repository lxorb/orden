import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const TOKENS = fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url))

const SCALE = {
  '--touch-target': '48px',
  '--touch-row': '56px',
  '--touch-text': '17px',
  '--touch-icon': '24px',
  '--touch-mark': '20px',
  '--touch-gap': '12px',
  '--touch-pad': '14px',
  '--touch-indent': '18px',
}

const ROW_SCALE = {
  '--row-height': 'var(--touch-row)',
  '--row-height-sm': 'var(--touch-target)',
  '--row-pad': 'var(--touch-pad)',
  '--row-gap': 'var(--touch-gap)',
  '--row-indent': 'var(--touch-indent)',
  '--header-height': 'var(--touch-row)',
  '--icon-md': 'var(--touch-mark)',
  '--icon-lg': 'var(--touch-icon)',
  '--text-row': 'var(--touch-text)',
}

const SURFACES = [
  'lib/Bookmarks.svelte',
  'lib/CanvasBar.svelte',
  'lib/ContextMenu.svelte',
  'lib/FindBar.svelte',
  'lib/Links.svelte',
  'lib/Palette.svelte',
  'lib/SearchPanel.svelte',
  'lib/Sidebar.svelte',
  'lib/SidebarFoot.svelte',
  'lib/SpaceSwitcher.svelte',
  'lib/TagTree.svelte',
  'lib/Titlebar.svelte',
  'lib/Tree.svelte',
]

const FINGER_HEIGHT = 40
const BODY_SIZE = 14

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

function styleOf(text: string): string {
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((one) => one[1] ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
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
    style: styleOf(text),
  }
})

function rules(style: string): { selector: string; body: string }[] {
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((one) => ({
    selector: (one[1] ?? '').trim().replace(/\s+/g, ' '),
    body: one[2] ?? '',
  }))
}

function forTouch(selector: string): boolean {
  return /\[data-touch\]|\.phone\b|\.touch\b|\.sheet\b/.test(selector)
}

describe('the touch scale', () => {
  test('the scan finds the components', () => {
    expect(components.length).toBeGreaterThan(10)
  })

  test('the scale is stated once, in the tokens', () => {
    const tokens = readFileSync(TOKENS, 'utf8')

    for (const [name, value] of Object.entries(SCALE)) {
      expect(tokens, `${name} is missing from the tokens`).toContain(`${name}: ${value};`)
    }

    expect(tokens).toContain(
      '--touch-bottom: max(var(--space-4), calc(var(--space-4) + var(--inset-bottom) - var(--keyboard)));',
    )
    expect(tokens).toContain('--keyboard: 0px;')
  })

  test('no touch rule names a finger-sized number of its own', () => {
    const offenders: string[] = []

    for (const one of components) {
      for (const rule of rules(one.style)) {
        if (!forTouch(rule.selector)) continue

        for (const [, property, size] of rule.body.matchAll(
          /(min-height|height|font-size):\s*([\d.]+)px/g,
        )) {
          const pixels = Number(size)
          const tooBig = property === 'font-size' ? pixels >= BODY_SIZE : pixels >= FINGER_HEIGHT
          if (tooBig) offenders.push(`${one.name}: ${rule.selector} { ${property}: ${size}px }`)
        }
      }
    }

    expect(
      offenders,
      `these size themselves instead of reading the scale:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  test('the row scale is restated from the touch scale, in one block', () => {
    const tokens = readFileSync(TOKENS, 'utf8')
    const block = /\[data-touch\]\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? ''

    expect(block, 'the tokens have no [data-touch] block').not.toBe('')

    for (const [name, from] of Object.entries(ROW_SCALE)) {
      expect(block, `${name} is not restated for a finger`).toContain(`${name}: ${from};`)
    }
  })

  test('the surfaces a thumb lands on read one of the two scales', () => {
    const scale =
      /var\(--(touch-(row|target|text|icon|mark|pad|gap|indent)|row-(height|height-sm|pad|gap|indent)|text-row|text-head|icon-(md|lg))\)/

    const missing = SURFACES.filter((name) => {
      const one = components.find((component) => component.name === name)
      return !one || !(scale.test(one.style) || one.text.includes('orden-row'))
    })

    expect(missing, `these draw a touch surface without the scale: ${missing.join(', ')}`).toEqual(
      [],
    )
  })

  test('a tree row is a row, and its marks are drawn at the row', () => {
    const tree = components.find((one) => one.name === 'lib/Tree.svelte')?.style ?? ''
    const mark = components.find((one) => one.name === 'lib/FileMark.svelte')?.style ?? ''

    expect(tree).toContain('var(--row-indent)')
    expect(mark).toContain('width: var(--icon-md)')
    expect(mark).toContain('height: var(--icon-md)')
  })
})
