import { describe, expect, test } from 'vitest'
import { ordenCss } from './browser'

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
    const css = ordenCss({ name: 'Dusk', source, css: false })

    expect(css).not.toContain("data-theme='light'")
    expect(tokens(css, 'dark')).toMatchObject({
      '--bg': '#101010',
      '--surface': '#28323c',
      '--tab-frame': '#0a141e',
      '--text': '#f0f0f0',
      '--accent': '#ff8800',
      '--accent-ink': '#000000',
    })
    // A white list under light words is a ground that cannot carry the ink.
    expect(css).not.toContain('--side-bar-bg-color')
    expect(ordenCss({ name: 'Pictures', source: '{"images":{}}', css: false })).toBe('')
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
    const css = ordenCss({ name: 'userChrome', source, css: true })

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
  })
})
