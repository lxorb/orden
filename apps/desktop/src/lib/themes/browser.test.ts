import { describe, expect, test } from 'vitest'
import { ordenCss, paged } from './browser'

/** The tokens of one scheme's block, by name. */
function tokens(css: string, scheme: string): Record<string, string> {
  const block = new RegExp(`data-theme='${scheme}'\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  const entries = block.split(';\n').map((line) => line.trim().split(': ') as [string, string])
  return Object.fromEntries(entries)
}

describe('a browser theme as an Orden theme', () => {
  test("a manifest's parts land on the nearest tokens, in the scheme its ground is", () => {
    const source = JSON.stringify({
      colors: {
        frame: [10, 20, 30],
        toolbar: [40, 50, 60, 1],
        ntp_background: '#101010',
        tab_text: 'rgb(240, 240, 240)',
        tab_line: '#ff8800',
        sidebar: 'white',
      },
    })
    const css = ordenCss({ name: 'Dusk', source, css: false, pages: '' })

    expect(css).not.toContain("data-theme='light'")
    expect(css).not.toContain('data-translucent')
    expect(tokens(css, 'dark')).toMatchObject({
      '--bg': '#101010',
      '--surface': '#28323c',
      '--tab-frame': '#0a141e',
      '--text': '#f0f0f0',
      '--accent': '#ff8800',
      '--accent-ink': '#000000',
    })
    // A white list cannot carry light words, so it is as much white as they read on.
    expect(tokens(css, 'dark')['--side-bar-bg-color']).toBe('#404040')
    expect(ordenCss({ name: 'Pictures', source: '{"images":{}}', css: false, pages: '' })).toBe('')
  })

  test('a userContent.css is a line of pages, each block with its addresses', () => {
    const line = paged(`
      body { background-color: #22242a80 !important; }
      @-moz-document url(about:blank), url-prefix("https://www.google.") { img { filter: none; } }
      @-moz-document domain(example.org) { p { color: red; } }`)
    const said = JSON.parse(/nib-pages (.*) \*\/\n$/.exec(line)?.[1] ?? '') as {
      clear: boolean
      sheets: { match: string; css: string }[]
    }

    expect(said.clear).toBe(true)
    expect(said.sheets.map((one) => one.match)).toEqual([
      '',
      '^about:blank$|^https://www\\.google\\.',
      '^[a-z-]+://([^/]*\\.)?example\\.org[/:]',
    ])
    expect(new RegExp(said.sheets[1]?.match ?? '').test('https://www.google.de/search')).toBe(true)
    expect(new RegExp(said.sheets[2]?.match ?? '').test('https://sub.example.org/a')).toBe(true)
    expect(new RegExp(said.sheets[2]?.match ?? '').test('https://notexample.org/')).toBe(false)
    expect(said.sheets[1]?.css.trim()).toBe('img { filter: none; }')
    // Nothing a comment could end on, and nothing at all where nothing is said.
    expect(line.slice(3, -4)).not.toContain('*/')
    expect(paged('')).toBe('')
  })

  test('hsl() and light-dark() are read as the colours they are', () => {
    const colors = {
      frame: 'hsl(220, 72%, 28%)',
      ntp_background: 'hsl(221 63% 87% / 1)',
      ntp_text: 'hsl(0, 0%, 0%)',
    }
    const light = ordenCss({
      name: 'Activist',
      source: JSON.stringify({ colors }),
      css: false,
      pages: '',
    })
    expect(tokens(light, 'light')).toMatchObject({ '--bg': '#c9d6f3', '--text': '#000000' })
    // Its deep blue frame cannot carry the note's black, so it is a wash of that blue.
    expect(tokens(light, 'light')['--tab-frame']).toBe('#93a6cf')

    const source =
      ':root { --toolbar-bgcolor: light-dark(#f7f7f7, color-mix(in srgb, #000 80%, #fff)); }'
    const both = ordenCss({
      name: 'Either',
      source: `${source} #nav-bar { color: light-dark(#000, #fff) }`,
      css: true,
      pages: '',
    })
    expect(tokens(both, 'light')).toMatchObject({ '--bg': '#f7f7f7', '--text': '#000000' })
    expect(both).not.toContain("data-theme='dark'")
  })

  test('a stylesheet is read by its cascade, a scheme to a block', () => {
    const source = `
      @namespace url(x);
      :root { --ink: #F2F2F2; --glass: #00000066; --toolbar-bgcolor: transparent !important; }
      @media (-moz-toolbar-prefers-color-scheme: light) { :root { --ink: #0A0A0A; --glass: #F2F2F266; } }
      @media (prefers-color-scheme: dark) { :root { --ink: #F2F2F2; } }
      #TabsToolbar { background: var(--glass) !important; }
      #sidebar-box { --sidebar-background-color: var(--glass) !important; }
      .tab-background:not([visuallyselected]), .tab-background[selected] { background: #F2F2F210 }
      .toolbarbutton-text { color: var(--ink) !important; }
      toolbar#nav-bar:hover { background: red; }
      #TabsToolbar { background: transparent !important; }
      toolbar#nav-bar { background-color: rgba(0, 0, 0, 0.4) !important; }`
    const css = ordenCss({ name: 'userChrome', source, css: true, pages: '' })

    // The see-through strip is no frame, so the frame is the toolbar's.
    expect(tokens(css, 'dark')).toMatchObject({
      '--bg': '#0f0f0f',
      '--surface': '#000000',
      '--tab-frame': '#000000',
      '--side-bar-bg-color': '#000000',
      '--text': '#f2f2f2',
    })
    expect(tokens(css, 'light')).toMatchObject({
      '--bg': '#fefefe',
      '--side-bar-bg-color': '#fafafa',
      '--text': '#0a0a0a',
    })
    expect(css).not.toContain('--accent')

    // And over the desk it is what it was written as: a strip that is not there, a
    // tab that is a breath of white, a list that is two fifths black.
    const glass = /data-translucent\]\[data-theme='dark'\] \{([^}]*)\}/.exec(css)?.[1]
    expect(glass).toContain('--shell-ground: rgb(0 0 0 / 0.000);')
    expect(glass).toContain('--content-ground: rgb(242 242 242 / 0.063);')
    expect(glass).toContain('--side-bar-bg-color: rgb(0 0 0 / 0.400);')
  })
})
