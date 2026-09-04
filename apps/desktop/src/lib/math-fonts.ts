import { katexCss } from '@nib/themes/raw'

/** Every KaTeX face as a `data:` URI, baked in at build time. The package is
 *  a dependency of the app, so the path is stable. */
const FONTS = import.meta.glob('/node_modules/katex/dist/fonts/*.woff2', {
  query: '?inline',
  eager: true,
  import: 'default',
}) as Record<string, string>

const FACE = /@font-face\{[^}]*\}/g
const RULE = /([^{}]+)\{([^{}]*)\}/g
/** `.katex` itself names its face through the `font:` shorthand. */
const FAMILY = /font(?:-family)?:[^;]*?(KaTeX_[\w-]+)/

function fontData(file: string): string | null {
  const entry = Object.entries(FONTS).find(([path]) => path.endsWith(`/${file}`))
  return entry ? entry[1] : null
}

/** For each font family, the class names whose rules ask for it. `.katex`
 *  itself is on every selector and says nothing, so the last compound of a
 *  selector is what counts: `.katex .mathfrak` needs `mathfrak` on the page. */
function familiesByClass(css: string): Map<string, string[][]> {
  const families = new Map<string, string[][]>()

  for (const [, selector, body] of css.replace(FACE, '').matchAll(RULE)) {
    const family = FAMILY.exec(body)?.[1]
    if (!family) continue

    for (const part of selector.split(',')) {
      const compounds = part.trim().split(/\s*[\s>+~]\s*/).reverse()
      const classes = compounds
        .map((compound) => [...compound.matchAll(/\.([\w-]+)/g)].map((match) => match[1]))
        .find((found) => found.length)

      if (classes) families.set(family, [...(families.get(family) ?? []), classes])
    }
  }

  return families
}

/** KaTeX's stylesheet with its fonts inside it, cut down to the faces the
 *  page actually uses. Nothing at all when the page has no maths: a document
 *  without an equation should not carry a font for one. */
export function mathCss(html: string): string {
  if (!html.includes('class="katex')) return ''

  const families = familiesByClass(katexCss)
  const used = (family: string) =>
    (families.get(family) ?? []).some((classes) => classes.every((name) => html.includes(name)))

  const faces = [...katexCss.matchAll(FACE)]
    .map((match) => match[0])
    .filter((face) => used(FAMILY.exec(face)?.[1] ?? ''))
    .map((face) =>
      face.replace(/src:[^;}]+/, (src) => {
        const file = /url\(fonts\/([^)]+\.woff2)\)/.exec(src)?.[1]
        const data = file && fontData(file)
        return data ? `src:url(${data}) format("woff2")` : src
      }),
    )

  return faces.join('') + katexCss.replace(FACE, '')
}
