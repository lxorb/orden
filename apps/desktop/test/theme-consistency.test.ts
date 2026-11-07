import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

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
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n')
}

const components = componentFiles(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: styleOf(readFileSync(path, 'utf8')),
}))

describe('the look of things the browser also has an opinion about', () => {
  test('the scan finds the components', () => {
    expect(components.length).toBeGreaterThan(10)
  })

  test('nothing opts out of the themed scrollbar', () => {
    const offenders = components
      .filter((one) => /scrollbar-width:\s*(thin|auto)/.test(one.text))
      .map((one) => one.name)

    expect(offenders, `these would show the browser's scrollbar: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  test('every scroller that hides the engine bar hides it in every engine', () => {
    const sheets = [
      ...components,
      ...readdirSync(THEMES)
        .filter((name) => name.endsWith('.css'))
        .map((name) => ({ name, text: readFileSync(join(THEMES, name), 'utf8') })),
    ]
    const offenders = sheets.flatMap((one) =>
      [...one.text.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
        .filter(([, , body = '']) => /scrollbar-width:\s*none/.test(body))
        .flatMap(([, selector = '']) => selector.split(',').map((part) => part.trim()))
        .filter((selector) => {
          const twin = new RegExp(
            `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}::-webkit-scrollbar\\s*\\{[^}]*display:\\s*none`,
          )
          return !twin.test(one.text)
        })
        .map((selector) => `${one.name}: ${selector}`),
    )

    expect(offenders, `these show the bar in WebKit before 18.2: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  test("the theme's bar never outranks a scroller that hides its own", () => {
    const base = readFileSync(join(THEMES, 'base.css'), 'utf8')
    const unwrapped = (selector: string) => {
      let out = selector
      for (let at = out.indexOf(':where('); at >= 0; at = out.indexOf(':where(')) {
        let depth = 0
        let end = at + ':where'.length
        for (; end < out.length; end++) {
          if (out[end] === '(') depth++
          if (out[end] === ')' && --depth === 0) break
        }
        out = out.slice(0, at) + out.slice(end + 1)
      }
      return out
    }
    const themed = [...base.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
      .flatMap(([, selector = '']) => selector.split(',').map((part) => part.trim()))
      .filter((selector) => selector.includes('::-webkit-scrollbar'))
      .filter((selector) => !/^\.[\w-]+::/.test(selector))
    const loud = themed.filter((selector) =>
      /[.:[#]/.test(unwrapped(selector).split('::')[0] ?? ''),
    )

    expect(themed.length).toBeGreaterThan(4)
    expect(loud, `these beat .orden-scrolls::-webkit-scrollbar: ${loud.join(', ')}`).toEqual([])
  })

  test('no component restyles a dropdown on its own', () => {
    const offenders = components
      .filter((one) =>
        [...one.text.matchAll(/(?<![\w-])select(?![\w-])[^{;]*\{([^}]*)\}/g)].some(
          ([, body = '']) => /(appearance|background|border|font-family)\s*:/.test(body),
        ),
      )
      .map((one) => one.name)

    expect(
      offenders,
      `these would diverge from the themed dropdown: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  test('no component states a custom property in terms of itself', () => {
    const cycles = components.flatMap((one) =>
      [...one.text.matchAll(/--([\w-]+)\s*:\s*var\(\s*--([\w-]+)\s*[,)]/g)]
        .filter(([, named, read]) => named === read)
        .map(([said]) => `${one.name}: ${said.trim()}`),
    )

    expect(cycles, `these resolve to nothing at all: ${cycles.join(', ')}`).toEqual([])
  })
})

function sourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|svelte|css)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

describe('what a theme reaches, now that contrast is one', () => {
  const SYNTAX = ['--syntax-number', '--syntax-function', '--syntax-type', '--syntax-property']
  const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')

  function blockFor(scheme: 'dark' | 'light'): string {
    const dark = tokens.slice(tokens.indexOf("[data-theme='dark']"))
    const [own = '', rest = ''] = dark.split("[data-theme='light']")
    return scheme === 'dark' ? own : rest
  }

  test('states the four syntax colours in both schemes, so a theme can restate them', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const block = blockFor(scheme)
      for (const token of SYNTAX) expect(block, `${token} on ${scheme}`).toContain(`${token}:`)
    }
  })

  test('and spells them apart from the gutter, which is a different colour entirely', () => {
    expect(tokens).toContain('--code-number-color:')
    expect(tokens).not.toMatch(/--code-(number|function|type|property):/)
  })

  test('and nothing paints contrast over a theme from outside it', () => {
    const offenders = [...sourceFiles(SOURCE), ...sourceFiles(THEMES)]
      .filter((path) => /data-contrast|dataset\.contrast/.test(readFileSync(path, 'utf8')))
      .map((path) => path.replace(/\\/g, '/').split('/').slice(-2).join('/'))

    expect(offenders, `these still write the attribute: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('the paper a note is written on', () => {
  const PAPER = 'background: var(--content-ground, var(--bg));'

  function ruleOf(name: string, selector: string): string {
    const text = components.find((one) => one.name === name)?.text ?? ''
    const opens = new RegExp(`(?:^|\\n)\\s*\\.${selector}\\s*\\{([^}]*)\\}`)
    return opens.exec(text)?.[1] ?? ''
  }

  test('is what a pane lays under itself', () => {
    expect(ruleOf('lib/Pane.svelte', 'pane')).toContain(PAPER)
  })

  test('is the page itself, whole, under the scratchpad', () => {
    expect(ruleOf('lib/scratchpad/ScratchpadCard.svelte', 'card')).toContain(
      'background: var(--bg);',
    )
  })

  test('is see-through under a pane alone', () => {
    const offenders = components
      .filter((one) => one.name !== 'lib/Pane.svelte' && /var\(--content-ground\b/.test(one.text))
      .map((one) => one.name)

    expect(offenders, `these lay the see-through paper: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('what a side shows', () => {
  const FLOATING = ['orden-layer', 'orden-screen', 'orden-bubble']
  const sidebar = readFileSync(join(SOURCE, 'lib/Sidebar.svelte'), 'utf8')
  const surfaces = readFileSync(join(SOURCE, 'lib/surfaces.svelte.ts'), 'utf8')
  const shown = [...sidebar.matchAll(/\{#await (\w+)\(\) then/g)].map((one) => {
    const door = one[1] ?? ''
    const from = new RegExp(`export const ${door} = [\\s\\S]*?import\\('\\./([^']+)'\\)`)
    return `lib/${from.exec(surfaces)?.[1] ?? door}`
  })

  interface Node {
    type?: string
    [key: string]: unknown
  }

  function* outermost(node: unknown): Generator<Node> {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const one of node) yield* outermost(one)
      return
    }
    const one = node as Node
    if (one.type === 'RegularElement') {
      yield one
      return
    }
    for (const [key, value] of Object.entries(one)) if (key !== 'parent') yield* outermost(value)
  }

  function classesOf(node: Node): string[] {
    const words: string[] = []
    for (const one of (node.attributes ?? []) as Node[]) {
      if (one.type === 'ClassDirective') words.push(String(one.name))
      if (one.type !== 'Attribute' || one.name !== 'class' || !Array.isArray(one.value)) continue
      for (const part of one.value as Node[])
        if (part.type === 'Text') words.push(...String(part.data).split(/\s+/))
    }
    return words.filter(Boolean)
  }

  test('finds the panels', () => {
    expect(shown).toContain('lib/scratchpad/ScratchpadCard.svelte')
    expect(shown).toContain('lib/views/TasksPanel.svelte')
    expect(shown).toContain('lib/ai/sidebar/ChatPanel.svelte')
  })

  test.each(shown.map((name) => [name]))('%s stands in it', (name) => {
    const source = readFileSync(join(SOURCE, name), 'utf8')
    const tree = parse(source, { modern: true })
    const style = styleOf(source)
    for (const root of outermost(tree.fragment)) {
      const classes = classesOf(root)
      expect(
        classes.filter((one) => FLOATING.includes(one)),
        name,
      ).toEqual([])
      for (const one of classes) {
        const rule = new RegExp(`(?:^|\\n)\\s*\\.${one}(?:\\.[\\w-]+)*\\s*\\{([^}]*)\\}`, 'g')
        for (const [, body] of style.matchAll(rule))
          expect(/box-shadow:(?!\s*(?:none|inset))/.test(body ?? ''), `${name} .${one}`).toBe(false)
      }
    }
  })
})

describe('what runs out under something', () => {
  const style = (name: string) => components.find((one) => one.name === name)?.text ?? ''

  test('the AI panel’s thread fades by a mask', () => {
    expect(style('lib/ai/sidebar/Conversation.svelte')).toMatch(
      /\.talk\s*\{[^}]*mask-image:\s*linear-gradient\(to bottom/,
    )
  })

  test('and nothing fades to a ground colour over the end of a scroller', () => {
    const offenders = components
      .filter((one) =>
        /linear-gradient\(\s*to (?:top|bottom),\s*var\(--[a-z-]+\),\s*transparent\)/.test(one.text),
      )
      .map((one) => one.name)
    expect(offenders, `these fade to a guessed ground: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('what the AI chat is filled with', () => {
  const chat = components.filter((one) =>
    /^lib\/(?:ai\/(?:sidebar|review)\/|QuickQuestion\.svelte$)/.test(one.name),
  )
  const style = (name: string) => chat.find((one) => one.name === name)?.text ?? ''

  test('finds the chat', () => {
    expect(chat.length).toBeGreaterThan(10)
  })

  test('the reader’s message is a wash of the ink over whatever it stands on', () => {
    expect(style('lib/ai/sidebar/Conversation.svelte')).toMatch(
      /\n\s*\.bubble\s*\{[^}]*background:\s*var\(--ink-wash\)/,
    )
    expect(style('lib/QuickQuestion.svelte')).toMatch(
      /\n\s*\.said\s*\{[^}]*background:\s*var\(--ink-wash\)/,
    )
  })

  test('and nothing in it is filled with the ground the side stands on', () => {
    const offenders = chat
      .filter((one) =>
        /background(?:-color)?:\s*var\(--(?:surface-2|tab-frame|chrome-ground)\)/.test(one.text),
      )
      .map((one) => one.name)
    expect(offenders, `these vanish into the chrome's ground: ${offenders.join(', ')}`).toEqual([])
  })
})
