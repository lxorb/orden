import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { AA, ratio, rgbOf } from '../legibility'
import { FIXED_PALETTE, terminalGround, terminalPalette, type TerminalTokens } from './look'

const THEMES = fileURLToPath(new URL('../../../../../packages/themes/src/', import.meta.url))

/** Every token a block of a stylesheet states, as written. */
function block(file: string, selector: string): Record<string, string> {
  const css = readFileSync(`${THEMES}${file}`, 'utf8')
  const at = css.indexOf(`${selector} {`)
  if (at === -1) throw new Error(`no ${selector} in ${file}`)
  const body = css.slice(at, css.indexOf('\n}', at))
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((one): [string, string] => [
      one[1] ?? '',
      (one[2] ?? '').trim(),
    ]),
  )
}

/** `rgb(r g b / a)` as the comma form rgbOf reads too; a hex as it is. */
const plain = (said: string | undefined) => (said ?? '').replace(/\s*\/\s*[\d.]+\s*\)/, ')')

function tokensOf(theme: Record<string, string>, light: boolean): TerminalTokens {
  return {
    light,
    background: plain(theme['--bg']),
    foreground: plain(theme['--text']),
    strong: plain(theme['--text-strong']),
    muted: plain(theme['--muted']),
    accent: plain(theme['--accent'] ?? '#7c6bf5'),
    ground: plain(theme['--surface-3']),
    surface: plain(theme['--surface-2']),
    selection: theme['--selection'] ?? '',
    hues: {
      red: plain(theme['--canvas-1']),
      green: plain(theme['--canvas-4']),
      yellow: plain(theme['--canvas-3']),
      blue: plain(theme['--syntax-function']),
      magenta: plain(theme['--canvas-6']),
      cyan: plain(theme['--canvas-5']),
    },
  }
}

const DARK = tokensOf(block('tokens.css', "[data-theme='dark']"), false)
const LIGHT = tokensOf(block('tokens.css', "[data-theme='light']"), true)

const SCHEMES: [string, TerminalTokens][] = [
  ['dark', DARK],
  ['light', LIGHT],
  [
    'high contrast dark',
    tokensOf(
      {
        ...block('tokens.css', "[data-theme='dark']"),
        ...block('contrast.css', "[data-theme='dark']"),
      },
      false,
    ),
  ],
  [
    'high contrast light',
    tokensOf(
      {
        ...block('tokens.css', "[data-theme='light']"),
        ...block('contrast.css', "[data-theme='light']"),
      },
      true,
    ),
  ],
]

const HUES = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
const bright = (name: string) => `bright${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`

function on(palette: Record<string, unknown>, name: string): number {
  const one = rgbOf(String(palette[name]))
  const ground = rgbOf(String(palette.background))
  if (!one || !ground) throw new Error(`${name} is no colour`)
  return ratio(one, ground)
}

// #1069: the theme is the terminal's, and every colour a program asks for reads on it.
describe('a terminal in the theme', () => {
  test.each(SCHEMES)(
    'in %s, every hue and its bright half read on the ground, apart',
    (_, tokens) => {
      const palette = terminalPalette(tokens) as Record<string, unknown>
      expect(palette.background).toBe(tokens.background)
      for (const name of HUES) {
        expect([name, on(palette, name) >= AA]).toEqual([name, true])
        expect([bright(name), on(palette, bright(name)) >= AA]).toEqual([bright(name), true])
        expect(palette[bright(name)]).not.toBe(palette[name])
      }
      expect(on(palette, 'brightBlack')).toBeGreaterThanOrEqual(3)
      expect(on(palette, 'foreground')).toBeGreaterThanOrEqual(AA)
      expect(palette.cursor).toBe(tokens.accent)
    },
  )

  test('a theme whose hues are too pale for its ground has them moved until they read', () => {
    const pale: TerminalTokens = {
      ...LIGHT,
      background: '#ffffff',
      hues: {
        red: '#ffd0d0',
        green: '#d0ffd0',
        yellow: '#ffff80',
        blue: '#d0d0ff',
        magenta: '#ffd0ff',
        cyan: '#d0ffff',
      },
    }
    const palette = terminalPalette(pale) as Record<string, unknown>
    for (const name of HUES) expect(on(palette, name)).toBeGreaterThanOrEqual(AA)
  })

  test('a theme that sets the terminal itself is taken at its word', () => {
    const tokens = DARK
    const palette = terminalPalette({
      ...tokens,
      own: { red: '#ff0000', background: '#000000', selectionBackground: 'rgba(1, 2, 3, 0.5)' },
    })
    expect(palette.red).toBe('#ff0000')
    expect(palette.background).toBe('#000000')
    expect(palette.selectionBackground).toBe('rgba(1, 2, 3, 0.5)')
    expect(palette.green).toBe(terminalPalette(tokens).green)
  })

  test('the fixed palette a reader can keep instead reads too', () => {
    const palette = FIXED_PALETTE as Record<string, unknown>
    for (const name of HUES) {
      expect(on(palette, name)).toBeGreaterThanOrEqual(AA)
      expect(on(palette, bright(name))).toBeGreaterThanOrEqual(AA)
    }
    expect(on(palette, 'brightBlack')).toBeGreaterThanOrEqual(3)
  })
})

/** #1110: the open tab of a terminal stands on the ground the terminal draws, which is
 *  not the note's paper - the theme's terminal colours, or the one kept palette. */
describe("the ground a terminal's open tab stands on", () => {
  test('is the one the terminal draws', () => {
    expect(terminalGround(FIXED_PALETTE)).toBe('#16181d')
    expect(terminalGround({ background: '#0b0d10' })).toBe('#0b0d10')
  })

  test('is none where the terminal is see-through and stands on the pane', () => {
    expect(terminalGround({ background: 'rgba(22, 24, 29, 0)' })).toBeNull()
    expect(terminalGround({})).toBeNull()
  })

  test("is what the strip wears on a terminal's open tab", () => {
    const tabs = readFileSync(fileURLToPath(new URL('../Tabs.svelte', import.meta.url)), 'utf8')
    expect(tabs).toMatch(/\.tab\.onterminal \{\s*--tab-ground: var\(--terminal-paper,/)
    expect(tabs).toContain(
      "style:--terminal-paper={tab.kind === 'terminal' ? chrome.terminal : null}",
    )
  })
})
