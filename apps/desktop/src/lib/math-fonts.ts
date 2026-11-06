import { katexCss } from '@orden/themes/raw'

const FONTS = import.meta.glob<string>('/node_modules/katex/dist/fonts/*.woff2', {
  query: '?inline',
  eager: true,
  import: 'default',
})

const FACE = /@font-face\{[^}]*\}/g
const RULE = /([^{}]+)\{([^{}]*)\}/g
const FAMILY = /font(?:-family)?:[^;]*?(KaTeX_[\w-]+)/

function fontData(file: string): string | null {
  const entry = Object.entries(FONTS).find(([path]) => path.endsWith(`/${file}`))
  return entry ? entry[1] : null
}

function familiesByClass(css: string): Map<string, string[][]> {
  const families = new Map<string, string[][]>()

  for (const [, selector = '', body = ''] of css.replace(FACE, '').matchAll(RULE)) {
    const family = FAMILY.exec(body)?.[1]
    if (!family) continue

    for (const part of selector.split(',')) {
      const compounds = part
        .trim()
        .split(/\s*[\s>+~]\s*/)
        .reverse()
      const classes = compounds
        .map((compound) => [...compound.matchAll(/\.([\w-]+)/g)].map(([, name = '']) => name))
        .find((found) => found.length)

      if (classes) families.set(family, [...(families.get(family) ?? []), classes])
    }
  }

  return families
}

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
