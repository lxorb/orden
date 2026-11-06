import { escape } from './html'

export const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(['mermaid', 'flow', 'sequence'])

export function isDiagram(language: string): boolean {
  return DIAGRAM_LANGUAGES.has(language.toLowerCase())
}

export type DiagramScheme = 'light' | 'dark'

export const DIAGRAM_SCHEMES: readonly DiagramScheme[] = ['light', 'dark']

export const DIAGRAM_NAMED = 'nib/diagram/v1\n'

export async function diagramKey(
  spaceId: string,
  language: string,
  code: string,
  scheme: DiagramScheme,
): Promise<string> {
  const said = `${DIAGRAM_NAMED}${spaceId}\n${language.toLowerCase()}\n${scheme}\n${code}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(said))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function diagramAlt(code: string): string {
  const described = /^\s*accDescr\s*:\s*(.+)$/m.exec(code)?.[1]
  const titled = /^\s*accTitle\s*:\s*(.+)$/m.exec(code)?.[1]
  const said = (described ?? titled)?.trim()

  return said === undefined || said === '' ? 'Diagram' : said
}

export function diagramFigure(
  language: string,
  alt: string,
  sources: { light: string; dark: string | null },
): string {
  const picture = (src: string, scheme?: DiagramScheme) =>
    `<img src="${escape(src)}" alt="${escape(alt)}"${scheme ? ` data-scheme="${scheme}"` : ''}>`

  const images =
    sources.dark === null
      ? picture(sources.light)
      : picture(sources.light, 'light') + picture(sources.dark, 'dark')

  return `<figure class="diagram" data-language="${escape(language)}">${images}</figure>\n`
}
