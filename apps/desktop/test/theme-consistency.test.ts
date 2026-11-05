import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'

/** Chrome and the app's theme are easy to drift apart quietly, because the
 *  browser has a default for everything and a default always looks like it
 *  works. These are the two that have bitten so far, so they are checked
 *  rather than remembered. */

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

/** Only the `<style>` block: markup carries `selected=` attributes, and a scan
 *  of the whole file reads those as CSS. */
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
    // `scrollbar-width` is the standard property, and setting it makes Chromium
    // ignore `::-webkit-scrollbar` for that element - so a component asking for
    // a thin scrollbar silently gets the operating system's instead of ours.
    // `none` is fine: that is a deliberate hide, not a different scrollbar.
    // Named outright rather than "not none": `\s*` can match nothing and let a
    // lookahead slip past the space, which flagged every deliberate hide.
    const offenders = components
      .filter((one) => /scrollbar-width:\s*(thin|auto)/.test(one.text))
      .map((one) => one.name)

    expect(offenders, `these would show the browser's scrollbar: ${offenders.join(', ')}`).toEqual(
      [],
    )
  })

  test('no component restyles a dropdown on its own', () => {
    // One rule in the theme package draws every dropdown, arrow included. A
    // second one in a component is how they drift apart.
    // Only restyling counts. Sizing one in a layout is a component's business;
    // giving it its own colours, border or arrow is not.
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

  /** A custom property stated in terms of itself is a cycle, and a cycle makes the
   *  property invalid at computed-value time rather than resolving to what it
   *  inherited. It is not "the same value, said again": it is the value gone, on that
   *  element and on everything under it. Nothing is reported, `getComputedStyle`
   *  answers the empty string, and every rule that reads it takes its fallback - so
   *  it looks like it works, which is what this file is for.
   *
   *  `.menu` in ContextMenu.svelte restated all four `--inset-*` "for the script",
   *  which is the one thing that never needs doing: a custom property inherits, so
   *  the tokens' own values on the document reach every element on the page. The
   *  script read four zeroes instead, and a phone's menu was placed clear of the
   *  notch by nothing while the sheet's own padding fell back with it. */
  test('no component states a custom property in terms of itself', () => {
    const cycles = components.flatMap((one) =>
      [...one.text.matchAll(/--([\w-]+)\s*:\s*var\(\s*--([\w-]+)\s*[,)]/g)]
        .filter(([, named, read]) => named === read)
        .map(([said]) => `${one.name}: ${said.trim()}`),
    )

    expect(cycles, `these resolve to nothing at all: ${cycles.join(', ')}`).toEqual([])
  })
})

/** Every file the app and the theme package are written from, whatever its kind:
 *  the scan below is looking for a line nobody should write again, and a rule in a
 *  stylesheet and a line of TypeScript are equally able to write it. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    // A test may name what the app may not write, and one below does.
    else if (/\.(ts|svelte|css)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

/** Contrast is a theme. Two things follow, and both are a line away from being
 *  undone by somebody who does not know the history: the four colours inside a
 *  code fence are tokens a theme states per scheme, and nothing outside a theme
 *  paints contrast over the page any more. */
describe('what a theme reaches, now that contrast is one', () => {
  const SYNTAX = ['--syntax-number', '--syntax-function', '--syntax-type', '--syntax-property']
  const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')

  /** One scheme's block. Split rather than parsed: the four belong beside the
   *  other colours of a scheme, not once at the top for both. */
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
    // `--code-number` was the syntax colour and `--code-number-color` the digits
    // in the margin: one hyphen apart, and nothing to do with each other.
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

/** A note stands on the note's paper wherever it is written, and the scratchpad is a
 *  note. Its card stood on `--surface`, the colour a menu floats on: a step off the page
 *  in the plain themes. On the see-through paper then, as a pane is, it was a narrow, tall
 *  strip of whatever is behind the window - glass's pair turning to its second colour
 *  towards the bottom corner - which read as a second ground under its lower half
 *  (#1110). So it is the paper itself, whole, and a pane is the one surface that lays the
 *  see-through paper. */
describe('the paper a note is written on', () => {
  const PAPER = 'background: var(--content-ground, var(--bg));'

  /** What one component's top-level rule for a class says. */
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

/** A side's body is a place on the window, and what it shows stands in it: the
 *  scratchpad's card wore a menu's shape there, whose shadow fell below its foot and out
 *  past its corner as a darker band (#1110). So nothing a side shows wears a floating
 *  layer's shape, or casts a shadow, at its outermost element. */
describe('what a side shows', () => {
  const FLOATING = ['nib-layer', 'nib-screen', 'nib-bubble']
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

/** A list or a thread that runs out under something fades out by a mask, so what shows
 *  through is whatever it stands on. A colour laid over its end is a token's guess at
 *  that ground: the AI panel's thread faded to the side's colour while the side stood
 *  on the chrome's, a darker strip and a band of the real ground above the field
 *  (#1110). */
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
