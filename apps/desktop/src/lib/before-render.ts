import { DIAGRAM_LANGUAGES, RENDERED_LANGUAGES } from '@orden/editor'
import { codeBlocks, type EmbeddedNote, findLinks, type Wikilink } from '@orden/markdown'
import { loadFor } from '@orden/markdown/engines'
import { highlightedFence } from '@orden/markdown/highlight'
import { escapeAll } from '@orden/markdown/html'
import { embedKind } from '@orden/markdown/links'
import { drawDiagram } from './diagrams'
import { loadParsers, type Parser } from './highlight'
import type { Scheme } from './theme/src/api'

export type Fence = (code: string, language: string) => string | null

export async function prepareEmbeds(
  source: string,
  read: (target: string) => Promise<string | EmbeddedNote | null>,
): Promise<(link: Wikilink) => string | EmbeddedNote | null> {
  const wanted = new Set(
    findLinks(source)
      .filter(
        (link) =>
          link.embed && link.kind === 'wikilink' && link.target && embedKind(link.target) === null,
      )
      .map((link) => link.target),
  )

  const bodies = new Map<string, string | EmbeddedNote>()
  await Promise.all(
    [...wanted].map(async (target) => {
      const body = await read(target).catch(() => null)
      if (body !== null) bodies.set(target, body)
    }),
  )

  return (link) => bodies.get(link.target) ?? null
}

export type Drawer = (code: string, language: string, scheme: Scheme) => Promise<string>

const ANSWERED = new Set(['query', 'tasks'])

export async function prepareFences(
  source: string,
  scheme: Scheme,
  options: {
    highlight?: boolean
    query?: ((code: string, language: string) => Promise<string | null>) | undefined
    base?: boolean
  } = {},
  draw: Drawer = drawDiagram,
): Promise<Fence> {
  const blocks = codeBlocks(source)
  const diagrams = new Map<string, string>()
  const answers = new Map<string, string>()
  const languages = new Set<string>()

  const drawings = blocks
    .filter((block) => DIAGRAM_LANGUAGES.has(block.language))
    .map(async (block) => {
      const svg = await draw(block.code, block.language, scheme).catch(() => null)
      if (svg) diagrams.set(`${block.language}\n${block.code}`, svg)
    })

  const asking = options.query
  const answering = asking
    ? blocks
        .filter((block) => ANSWERED.has(block.language))
        .map(async (block) => {
          const html = await asking(block.code, block.language).catch(() => null)
          if (html)
            answers.set(
              `${block.language}
${block.code}`,
              html,
            )
        })
    : []

  for (const block of blocks) {
    if (block.language && !RENDERED_LANGUAGES.has(block.language)) languages.add(block.language)
  }

  const [parsers] = await Promise.all([
    options.highlight === false ? new Map<string, Parser>() : loadParsers(languages),
    loadFor(source),
    ...drawings,
    ...answering,
  ])

  return fenceFrom({ parsers, diagrams, answers, base: options.base === true })
}

export interface FencesFound {
  parsers: ReadonlyMap<string, Parser>
  diagrams: ReadonlyMap<string, string>
  answers?: ReadonlyMap<string, string>
  base?: boolean
}

export function fenceFrom(found: FencesFound): Fence {
  const { parsers, diagrams, answers } = found
  return (code, language) => {
    if (language === 'base' && found.base) {
      const words = escapeAll(code)
      return `<figure class="base-fence" data-base-code="${words}"><pre><code>${words}</code></pre></figure>\n`
    }

    if (ANSWERED.has(language)) {
      const rows = answers?.get(`${language}
${code}`)
      return rows === undefined ? null : `<figure class="query">${rows}</figure>\n`
    }

    if (DIAGRAM_LANGUAGES.has(language)) {
      const svg = diagrams.get(`${language}\n${code}`)
      return svg ? `<figure class="diagram" data-language="${language}">${svg}</figure>\n` : null
    }

    const parser = parsers.get(language)
    if (!parser) return null

    return highlightedFence(code, language, parser)
  }
}
