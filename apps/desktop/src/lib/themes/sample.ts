/** The miniature a theme is judged by.
 *
 *  A card in the gallery shows a small note rendered with the theme's own
 *  tokens: a heading, a paragraph, a list, a fence. Not a screenshot, and not a
 *  second set of prose rules written to look like the app's - the app's own
 *  rules are taken as text and re-scoped, so a miniature cannot drift from the
 *  thing it is a miniature of. One stylesheet serves every card.
 *
 *  Scaled rather than shrunk: the page inside the frame is laid out at the width
 *  a real note has and then scaled down, so the proportions are the ones the
 *  reader will get. Eight-pixel text would only be mush. */

import { t } from '../i18n.svelte'
import type { Palette, StoreTheme } from './registry'

/** The frame, and the page inside it. Global names in the app's own `nib-`
 *  family, because the stylesheet below is injected rather than scoped: the
 *  markup is handed over as HTML and Svelte's scoping never reaches it. */
export const FRAME = 'nib-mini'
const PAGE = 'nib-mini-page'

/** Where the app's prose rules point once they are re-scoped. */
const SURFACE = `.${PAGE}`

/** The rules whose selectors mention the writing surface, pointed at the
 *  miniature's page instead.
 *
 *  Only the top level: a rule inside a media query belongs to a screen width,
 *  and the miniature's width is not the screen's. Nested blocks are skipped
 *  whole, which is also what keeps this from having to understand at-rules. */
export function rescoped(css: string, surface = SURFACE): string {
  const kept: string[] = []
  let at = 0
  let start = 0

  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) break

    // Walk to the matching brace, so a nested block is passed over as one.
    let depth = 1
    let close = open + 1
    while (close < css.length && depth > 0) {
      if (css[close] === '{') depth++
      else if (css[close] === '}') depth--
      close++
    }

    const prelude = css.slice(start, open).trim()
    const body = css.slice(open + 1, close - 1)
    start = close
    at = close

    if (prelude.startsWith('@') || !prelude.includes('#write') || body.includes('{')) continue

    kept.push(`${prelude.replace(/#write/g, surface)} {${body}}`)
  }

  return kept.join('\n')
}

/** The whole of the miniature's stylesheet: the frame it lives in, and the
 *  app's prose rules re-scoped to the page inside it. Built once, and asked for
 *  only when the gallery is first opened - the rules arrive as text, which is
 *  tens of kilobytes nobody who never opens the gallery should have to load. */
export async function miniatureCss(): Promise<string> {
  const { proseCss } = await import('@nib/themes/raw')

  return `.${FRAME} {
  position: relative;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  contain: strict;
}

.${PAGE} {
  /* Laid out at the width of a real note, then scaled: what the frame shows is
     the shape of the thing rather than a squashed version of it. */
  width: calc(100% / var(--mini-scale));
  height: calc(100% / var(--mini-scale));
  transform: scale(var(--mini-scale));
  transform-origin: top left;
  padding: 26px 30px 0;
  box-sizing: border-box;
  font-family: var(--font-content);
  font-size: var(--text-content);
  line-height: var(--leading-content);
  color: var(--text);
}

.${PAGE} > *:first-child {
  margin-top: 0;
}

/* Pointing at a card that has both schemes shows the other one, and this is
   what makes that a change of light rather than a flicker: the frame's scheme
   attribute is swapped, and every colour in it crosses over. A wildcard, but a
   wildcard inside a frame of eight elements. */
.${FRAME},
.${PAGE},
.${PAGE} * {
  transition:
    background-color var(--dur-slow) var(--ease-in-out),
    border-color var(--dur-slow) var(--ease-in-out),
    color var(--dur-slow) var(--ease-in-out);
}

${rescoped(proseCss)}`
}

/** One block per theme and scheme, so a card paints from the index alone.
 *
 *  Two attributes rather than one: the scheme attribute is the app's own, which
 *  means the frame starts with every built-in token for that scheme and the
 *  theme only has to state what it changes. Two attributes also outrank the
 *  app's one, so the theme wins without anything being marked important. */
export function paletteCss(themes: StoreTheme[]): string {
  const block = (id: string, scheme: string, palette: Palette) => {
    const lines = Object.entries(palette).map(([token, value]) => `  ${token}: ${value};`)
    if (!lines.length) return ''

    return `[data-palette='${id}'][data-theme='${scheme}'] {\n${lines.join('\n')}\n}`
  }

  return themes
    .flatMap((theme) => [
      block(theme.id, 'light', theme.palettes.light),
      block(theme.id, 'dark', theme.palettes.dark),
    ])
    .filter(Boolean)
    .join('\n')
}

/** The sample note, as the markup the renderer would have produced. Short
 *  enough that every card is the same handful of elements, and long enough to
 *  show what a theme did to a heading, a link, a list and a fence. */
export function sampleHtml(): string {
  const sentence = t('Words with {bold} and a {link}.', {
    bold: `<strong>${t('bold')}</strong>`,
    link: `<a href="#">${t('link')}</a>`,
  })

  return `<h2>${t('A note')}</h2>
<p>${sentence}</p>
<ul><li>${t('One thing')}</li><li>${t('Another')}</li></ul>
<pre><code>const ink = 'on glass'</code></pre>`
}
