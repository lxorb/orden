import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HTML = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)
const GROUND = readFileSync(fileURLToPath(new URL('../src/lib/ground.ts', import.meta.url)), 'utf8')

function background(scheme: 'dark' | 'light'): string {
  const block = TOKENS.split(`[data-theme='${scheme}']`).at(1) ?? ''
  return /--bg:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? ''
}

function rules(): { on: string; sets: string }[] {
  const style = HTML.split('<style>').at(1)?.split('</style>').at(0) ?? ''

  return style
    .split('}')
    .map((one) => one.split('{'))
    .filter((parts) => parts.length === 2)
    .map(([on, sets]) => ({
      on: (on ?? '').replace(/\s+/g, ' ').trim(),
      sets: sets ?? '',
    }))
}

function inline(selector: string): string {
  const rule = rules().find((one) => one.on === selector)
  return /background:\s*([^;]+);/.exec(rule?.sets ?? '')?.[1]?.trim() ?? ''
}

describe('the ground a launch paints before it has read anything', () => {
  test('is the dark palette’s own background', () => {
    expect(inline(':where(html)')).toBe(background('dark'))
  })

  test('and the light palette’s on the other side', () => {
    expect(inline(":where(html[data-theme='light'])")).toBe(background('light'))
  })

  test('and never outranks the app’s own sheet', () => {
    const coloured = rules().filter((one) => one.sets.includes('background:'))

    expect(coloured.length).toBeGreaterThan(0)
    expect(coloured.filter((one) => !/^:where\(.*\)$/.test(one.on))).toEqual([])
  })

  test('and the phone’s status bar is told the same colour', () => {
    expect(HTML).toContain(`<meta name="theme-color" content="${background('dark')}" />`)
  })

  test.each([
    ['nib:theme-scheme', 'which side of the theme was chosen'],
    ['nib:ground', 'the colour the window last stood on'],
  ])('reads %s (%s) from the same key the app writes', (key) => {
    expect(HTML).toContain(`localStorage.getItem('${key}')`)
  })

  test('and ground.ts writes the one it does not share with the theme', () => {
    expect(GROUND).toContain("const KEY = 'nib:ground'")
  })

  test('has nothing in the head but tags, comments and the three with bodies', () => {
    const head = HTML.split('<head>').at(1)?.split('</head>').at(0) ?? ''
    const left = head
      .replace(/<(style|script|title)>[\s\S]*?<\/\1>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')

    expect(left.trim()).toBe('')
  })

  test('puts no colour on the body, which is what lets a translucent window through', () => {
    const coloured = rules().filter((one) => one.sets.includes('background:'))

    expect(coloured.map((one) => one.on).filter((on) => /\bbody\b/.test(on))).toEqual([])
  })
})
