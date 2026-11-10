import { t } from '../i18n.svelte'
import type { Palette, StoreTheme } from './registry'
import { closes } from './validate'

export const FRAME = 'orden-mini'
const PAGE = 'orden-mini-page'

const SURFACE = `.${PAGE}`

const CARD_HEIGHT = 296
export const FULL_HEIGHT = 428

export function* rules(source: string): Generator<{ prelude: string; body: string }> {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  let at = 0
  let start = 0

  while (at < css.length) {
    const open = css.indexOf('{', at)
    if (open < 0) return

    const close = closes(css, open)
    const prelude = css.slice(start, open).trim()
    const body = css.slice(open + 1, close)

    start = close + 1
    at = close + 1

    if (!prelude.startsWith('@') && !body.includes('{')) yield { prelude, body }
  }
}

export function rescoped(css: string, surface = SURFACE): string {
  return [...rules(css)]
    .filter((rule) => rule.prelude.includes('#write'))
    .map((rule) => `${rule.prelude.replace(/#write/g, surface)} {${rule.body}}`)
    .join('\n')
}

export function scopedRoots(css: string, scope = `.${FRAME}`): string {
  return [...rules(css)]
    .filter((rule) => rule.prelude === ':root')
    .map((rule) => `${scope} {${rule.body}}`)
    .join('\n')
}

export async function miniatureCss(): Promise<string> {
  const { proseCss, tokensCss } = await import('@orden/themes/raw')

  return `${scopedRoots(tokensCss)}

${rescoped(proseCss)}

.${FRAME} {
  position: relative;
  overflow: hidden;
  /* The sample is the same handful of elements on every card, so its height is
     known: the frame is that height, scaled, and every card is the same shape
     without any of them being measured. */
  --mini-page: ${CARD_HEIGHT}px;
  height: calc(var(--mini-page) * var(--mini-scale));
  background: var(--bg);
  color: var(--text);
  contain: strict;
}

.${PAGE} {
  /* Laid out at the width of a real note, then scaled: what the frame shows is
     the shape of the thing rather than a squashed version of it. */
  width: calc(100% / var(--mini-scale));
  height: var(--mini-page);
  max-width: none;
  margin: 0;
  padding: 22px 26px 0;
  transform: scale(var(--mini-scale));
  transform-origin: top left;
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
}`
}

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

export function sampleHtml(full = false): string {
  const sentence = t('Words with {bold} and a {link}.', {
    bold: `<strong>${t('bold')}</strong>`,
    link: `<a>${t('link')}</a>`,
  })

  const more = full
    ? `
<blockquote><p>${t('Every note is a Markdown file you own, with to-dos, bases and boards right inside.')}</p></blockquote>
<hr>`
    : ''

  return `<h2>${t('A note')}</h2>
<p>${sentence}</p>
<ul><li>${t('One thing')}</li><li>${t('Another')}</li></ul>
<pre><code>const ink = 'on glass'</code></pre>${more}`
}
