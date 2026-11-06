const SOURCE = /(<(?:img|audio|video|source)\b[^>]*?\bsrc=")([^"]*)(")/g

export function sourcesOf(html: string, keep: (src: string) => boolean = () => true): string[] {
  const found = new Set<string>()

  for (const match of html.matchAll(SOURCE)) {
    const src = match[2] ?? ''
    if (src && keep(src)) found.add(src)
  }

  return [...found]
}

export function mapSources(html: string, swap: (src: string) => string | null): string {
  return html.replace(SOURCE, (whole: string, before: string, src: string, after: string) => {
    const next = swap(src)
    return next === null ? whole : `${before}${next}${after}`
  })
}
