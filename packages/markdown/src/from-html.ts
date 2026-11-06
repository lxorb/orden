import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { escapeText } from './escapes'
import { HIGHLIGHT_COLOURS, writeHighlight } from './highlights'
import { appHref, safeHref, safeSrc } from './html'
import { tagNameAt } from './tags'
import { taskWords } from './task-line'

const ESCAPED_FIELD = /\\\[([^[\]\\]*?::[^[\]\\]*?)\\\](?!\()/g

function withFields(words: string): string {
  return words.replace(ESCAPED_FIELD, '[$1]')
}

export const NEVER = [
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'meta',
  'link',
  'title',
  'iframe',
  'object',
  'embed',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
]

const CONTROL_WORDS = new Set(['label', 'legend', 'option', 'button', 'select', 'textarea'])

const NOT_A_FIELD = new Set(['hidden', 'submit', 'button', 'image', 'reset'])

const WORDS_A_FIELD = 20

export function formSays(form: Node): boolean {
  let words = 0
  let fields = 0
  const walk = (node: Node) => {
    for (const one of node.childNodes) {
      if (one.nodeType === 3) words += (one.textContent ?? '').split(/\s+/).filter(Boolean).length
      if (one.nodeType !== 1) continue
      const name = one.nodeName.toLowerCase()
      if (name === 'img' || name === 'picture') words += WORDS_A_FIELD
      if (name === 'textarea' || name === 'select') fields++
      if (name === 'input') {
        const type = (one as Element).getAttribute('type')?.toLowerCase() ?? 'text'
        if (!NOT_A_FIELD.has(type)) fields++
      }
      if (!CONTROL_WORDS.has(name) && !NEVER.includes(name)) walk(one)
    }
  }
  walk(form)
  return fields === 0 ? words > 0 : words >= fields * WORDS_A_FIELD
}

export interface FromHtmlOptions {
  image?: (source: string, alt: string) => string
  fileTargets?: boolean

  appTargets?: boolean

  mediaLinks?: boolean

  plainTasks?: boolean
}

const MEDIA: Record<string, string> = {
  video: 'src',
  audio: 'src',
  embed: 'src',
  iframe: 'src',
  object: 'data',
}

function mediaLink(node: Element, options: FromHtmlOptions): string {
  const attribute = MEDIA[node.nodeName.toLowerCase()] ?? 'src'
  const source = (
    node.getAttribute(attribute) ??
    node.querySelector('source[src]')?.getAttribute('src') ??
    ''
  ).trim()
  if (!source || !mayPointAt(source, options)) return ''

  const name = source.split(/[?#]/)[0]?.split('/').pop() ?? ''
  let shown = name
  try {
    shown = decodeURIComponent(name)
  } catch {
    // Not an escape after all; the name is shown as it was written.
  }

  const words = escapeText((shown || source).replace(/\s+/g, ' '))
  return `\n\n[${words}](${destination(source)})\n\n`
}

function texOf(maths: Element): string {
  const said =
    maths.getAttribute('data-tex') ??
    maths.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
    maths.getAttribute('alttext') ??
    ''

  return angled(said.replace(/\s+/g, ' ').trim())
}

function saysAFormula(node: Element): boolean {
  return node.nodeName.toLowerCase() === 'math' || node.hasAttribute('data-tex')
}

function drawnBeside(node: Element): boolean {
  if (node.getAttribute('aria-hidden') !== 'true') return false
  return !!node.parentElement?.querySelector('math, [data-tex]')
}

function saysWords(node: Node): boolean {
  if (node.nodeType === 3) return !!node.nodeValue?.trim()
  if (node.nodeType !== 1 || drawnBeside(node as Element)) return false

  for (let kid = node.firstChild; kid; kid = kid.nextSibling) {
    if (saysWords(kid)) return true
  }

  return false
}

function holdsOnly(parent: Element, one: Node): boolean {
  for (let kid = parent.firstChild; kid; kid = kid.nextSibling) {
    if (kid !== one && saysWords(kid)) return false
  }

  return true
}

function angled(tex: string): string {
  return tex.replace(/</g, '\\lt ').replace(/>/g, '\\gt ')
}

function firstBody(element: Element | null): boolean {
  if (element?.nodeName !== 'TBODY') return false

  const before = element.previousElementSibling
  return before === null || (before.nodeName === 'THEAD' && !before.textContent.trim())
}

function headed(table: HTMLTableElement): boolean {
  const first = table.rows[0]
  if (!first) return false

  const parent = first.parentElement
  if (parent?.nodeName === 'THEAD') return true

  const looked = parent?.nodeName === 'TABLE' || firstBody(parent)
  return (
    looked &&
    first.previousElementSibling === null &&
    [...first.cells].every((one) => one.nodeName === 'TH')
  )
}

function spanOf(cell: Element): number {
  const said = Number(cell.getAttribute('colspan'))
  return Number.isInteger(said) && said > 1 ? Math.min(said, MOST_COLUMNS) : 1
}

const MOST_COLUMNS = 100

const MOST_ROWS_SPANNED = 1000

function rowsBelow(cell: Element): number {
  const said = Number(cell.getAttribute('rowspan'))
  return Number.isInteger(said) && said > 1 ? Math.min(said, MOST_ROWS_SPANNED) - 1 : 0
}

interface Gaps {
  before: Map<Element, number>
  after: Map<Element, number>
}

const gapsOfTable = new WeakMap<Element, Gaps>()

function gapsOf(table: HTMLTableElement): Gaps {
  const known = gapsOfTable.get(table)
  if (known) return known

  const gaps: Gaps = { before: new Map(), after: new Map() }
  const covered: number[] = []
  for (const row of Array.from(table.rows)) {
    let column = 0
    for (const cell of Array.from(row.cells)) {
      let skipped = 0
      while ((covered[column] ?? 0) > 0) {
        covered[column] = (covered[column] ?? 0) - 1
        column++
        skipped++
      }
      if (skipped) gaps.before.set(cell, skipped)
      const across = spanOf(cell)
      for (let over = 0; over < across; over++) covered[column + over] = rowsBelow(cell)
      column += across
    }
    let after = 0
    for (let at = column; at < covered.length; at++) {
      if ((covered[at] ?? 0) > 0) {
        covered[at] = (covered[at] ?? 0) - 1
        after = at + 1 - column
      }
    }
    if (after) gaps.after.set(row, after)
  }
  gapsOfTable.set(table, gaps)
  return gaps
}

const ALIGNED: Readonly<Record<string, string>> = { left: ':--', right: '--:', center: ':-:' }

function emptyHeading(table: HTMLTableElement): string {
  const across = [...(table.rows[0]?.cells ?? [])].reduce((sum, one) => sum + spanOf(one), 0)

  return `|${'  |'.repeat(across)}\n|${' --- |'.repeat(across)}`
}

const OWNS_A_LINE = new Set(['P', 'DIV', 'DD', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'SECTION', 'BODY'])

const HEADING = /^H[1-6]$/

function standsAlone(maths: Element): boolean {
  if (OWNS_A_LINE.has(maths.nodeName)) return true

  let one: Element = maths
  let over: Element | null = maths.parentElement

  while (over) {
    if (HEADING.test(over.nodeName)) return false
    if (!holdsOnly(over, one)) return false
    if (OWNS_A_LINE.has(over.nodeName)) return true

    one = over
    over = over.parentElement
  }

  return false
}

function fenceFor(code: string): string {
  const longest = [...code.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

const A_LANGUAGE = /^[\w+#.-]{1,24}$/

const THE_APP_S_OWN = new Set(['ai', 'query'])

function languageOf(pre: Element): string {
  const code = pre.querySelector('code')

  for (const one of [pre, code]) {
    const named = one?.getAttribute('data-language') ?? one?.getAttribute('data-lang') ?? ''
    const first = named.trim().split(/\s+/)[0]
    if (first) return named_(first)
  }

  const classes = `${pre.className} ${code?.className ?? ''}`
  return named_(/(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? '')
}

function named_(said: string): string {
  const language = said.toLowerCase()
  return A_LANGUAGE.test(language) && !THE_APP_S_OWN.has(language) ? said : ''
}

export interface Work {
  lists: number
  items: number
  walked: number
}

function nothing(): Work {
  return { lists: 0, items: 0, walked: 0 }
}

const work = nothing()

export function workDone(): Work {
  const done = { ...work }
  Object.assign(work, nothing())
  return done
}

function indexer(): (parent: Element | null, node: Node) => number {
  const counted = new WeakMap<Element, Map<Node, number>>()

  return (parent, node) => {
    if (!parent) return 0

    work.items += 1
    let places = counted.get(parent)

    if (!places) {
      work.lists += 1
      places = new Map()
      const kids = parent.children

      for (let at = 0; at < kids.length; at++) {
        work.walked += 1
        const kid = kids[at]
        if (kid) places.set(kid, at)
      }

      counted.set(parent, places)
    }

    return places.get(node) ?? 0
  }
}

function altOf(image: Element): string {
  const words = (image.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim()
  if (image.closest('a')) {
    return words.replace(/\\/g, '/').replace(/\[/g, '(').replace(/\]/g, ')')
  }

  return words.replace(/([\\[\]])/g, '\\$1')
}

const IN_DESTINATION = /[\s\p{Cc}()<>\\"]/gu

const KEPT: Record<string, string> = { '(': '%28', ')': '%29' }

export function destination(address: string): string {
  return address.replace(IN_DESTINATION, (character) => {
    return KEPT[character] ?? encodeURIComponent(character)
  })
}

function preformattedText(node: Node): string {
  if (node.nodeName === 'BR') return '\n'
  if (node.nodeType === 3) return node.nodeValue ?? ''
  if (node.nodeType !== 1) return ''

  return [...node.childNodes].map(preformattedText).join('')
}

const BLOCKS =
  'address,article,aside,blockquote,div,dl,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul'

const HEAVY = /(?:^|;)\s*font-weight\s*:\s*(?:bold|bolder|[6-9]00)\b/iu
const LIGHT = /(?:^|;)\s*font-weight\s*:\s*(?:normal|lighter|[1-5]00)\b/iu
const SLANTED = /(?:^|;)\s*font-style\s*:\s*(?:italic|oblique)\b/iu
const UPRIGHT = /(?:^|;)\s*font-style\s*:\s*normal\b/iu

function marksFor(node: Element): string | null {
  const style = node.getAttribute('style') ?? ''
  const name = node.nodeName

  if (name === 'SPAN') {
    if (!HEAVY.test(style) && !SLANTED.test(style)) return null
  } else if (!['B', 'STRONG', 'I', 'EM'].includes(name)) return null

  const heavy = name === 'B' || name === 'STRONG' ? !LIGHT.test(style) : HEAVY.test(style)
  const slanted = name === 'I' || name === 'EM' ? !UPRIGHT.test(style) : SLANTED.test(style)
  return `${heavy ? '**' : ''}${slanted ? '*' : ''}`
}

function sameRun(node: Element, next: Node | null): Element | null {
  if (next?.nodeType !== 1) return null

  const other = next as Element
  const touching = !/\s$/u.test(node.textContent) && !/^\s/u.test(other.textContent)
  return touching && other.textContent !== '' && marksFor(other) === marksFor(node) ? other : null
}

function marksHold(node: Element): boolean {
  let first = node
  let last = node
  for (
    let one = sameRun(first, first.previousSibling);
    one;
    one = sameRun(first, one.previousSibling)
  ) {
    first = one
  }
  for (let one = sameRun(last, last.nextSibling); one; one = sameRun(last, one.nextSibling)) {
    last = one
  }

  const opening = first.textContent
  const closing = last.textContent
  const after = /\s$/u.test(closing) ? '' : (last.nextSibling?.textContent ?? '')
  const before = /^\s/u.test(opening) ? '' : (first.previousSibling?.textContent ?? '')
  const closes = /[\p{P}\p{S}]$/u.test(closing.trimEnd()) && /^[\p{L}\p{N}]/u.test(after)
  const opens = /^[\p{P}\p{S}]/u.test(opening.trimStart()) && /[\p{L}\p{N}]$/u.test(before)
  return !closes && !opens
}

function linkedBlocks(content: string, target: string): string {
  let fenced = false
  const blocks = content
    .trim()
    .split(/\n{2,}/u)
    .map((block) => {
      const closes = /(?:^|\n)`{3,}\s*$/u.test(block)
      if (fenced) {
        fenced = !closes
        return block
      }
      if (/^`{3,}/u.test(block)) {
        fenced = !/\n`{3,}\s*$/u.test(block)
        return block
      }
      if (block.includes('\n') || /^(?:-{3,}|\*{3,}|_{3,})$/u.test(block)) return block

      const found = /^(#{1,6} |> |(?:[-+*] |\d+[.)] )(?:\[[ x]\] )?)?(.*)$/u.exec(block.trim())
      return `${found?.[1] ?? ''}[${found?.[2] ?? ''}](${target})`
    })

  return `\n\n${blocks.join('\n\n')}\n\n`
}

function titleOf(link: Element): string {
  const title = (link.getAttribute('title') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/(["\\])/g, '\\$1')
    .trim()

  return title ? ` "${title}"` : ''
}

function mayPointAt(said: string, options: FromHtmlOptions, picture = false): boolean {
  if (options.fileTargets === true && /^file:/i.test(said.trim())) return true
  if (picture) return safeSrc(said)
  if (options.appTargets === true && appHref(said)) return true
  return safeHref(said)
}

function converter(options: FromHtmlOptions): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    blankReplacement: (_content, node) => {
      if (options.mediaLinks === true && node.nodeName === 'OBJECT') return mediaLink(node, options)
      return (node as { isBlock?: boolean }).isBlock ? '\n\n' : ''
    },
  })

  service.use(gfm)

  let insideLinks = 0
  service.escape = (text) => escapeText(text, { addresses: insideLinks === 0 })

  service.remove((node) => {
    const name = node.nodeName.toLowerCase()
    return NEVER.includes(name) || (name === 'form' && !formSays(node))
  })

  if (options.mediaLinks === true)
    service.addRule('media', {
      filter: (node) => node.nodeName.toLowerCase() in MEDIA,
      replacement: (_content, node) => mediaLink(node, options),
    })

  service.remove((node) => drawnBeside(node))

  const indexIn = indexer()

  service.addRule('emphasis', {
    filter: (node) => marksFor(node) !== null,
    replacement: (content, node) => {
      const element: Element = node
      const marks = marksFor(element) ?? ''
      if (
        !content.trim() ||
        !marks ||
        element.id.startsWith('docs-internal-guid') ||
        element.querySelector(BLOCKS) ||
        (element.nodeName === 'SPAN' && element.closest('code,pre,h1,h2,h3,h4,h5,h6')) ||
        !marksHold(element)
      ) {
        return content
      }

      const words = /^(\s*)([\s\S]*?)(\s*)$/u.exec(content)
      const opening = sameRun(element, element.previousSibling) ? '' : marks
      const closing = sameRun(element, element.nextSibling) ? '' : marks
      return `${words?.[1] ?? ''}${opening}${words?.[2] ?? ''}${closing}${words?.[3] ?? ''}`
    },
  })

  service.addRule('heading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const words = content.replace(/\s*\n\s*/gu, ' ').trim()
      return `\n\n${'#'.repeat(Number(node.nodeName.charAt(1)))} ${words}\n\n`
    },
  })

  service.addRule('looseTask', {
    filter: (node) => {
      if ((node as HTMLInputElement).type !== 'checkbox') return false
      const words = node.parentElement
      return (
        words?.nodeName === 'P' &&
        words.parentElement?.nodeName === 'LI' &&
        words.parentElement.firstElementChild === words &&
        words.firstChild === node
      )
    },
    replacement: (_content, node) => ((node as HTMLInputElement).checked ? '[x] ' : '[ ] '),
  })

  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, settings) => {
      const parent = node.parentNode as Element | null
      const ordered = parent?.nodeName === 'OL'
      const from = Number(parent?.getAttribute('start') ?? 1) || 1
      const at = indexIn(parent, node)

      const marker = ordered ? `${from + at}.` : (settings.bulletListMarker ?? '-')
      const indent = ' '.repeat(marker.length + 1)

      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, `\n${indent}`)
        .replace(/^(\[[ x]\])\s*/, '$1 ')
        .replace(
          /^(\[[ x]\] )([^\n]*)/,
          (_, box: string, words: string) =>
            box + (options.plainTasks === true ? taskWords(words) : withFields(words)),
        )

      const ends = node.nextSibling && !body.endsWith('\n') ? '\n' : ''
      return `${marker} ${body}${ends}`
    },
  })

  service.addRule('struck', {
    filter: ['del', 's'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  })

  service.addRule('highlight', {
    filter: ['mark'],
    replacement: (content, node) => {
      if (!content) return ''

      const named = (node as Element).className
      const found = HIGHLIGHT_COLOURS.find((one) => one.className && one.className === named)
      return `==${found ? writeHighlight(content, found) : content}==`
    },
  })

  service.addRule('underline', {
    filter: ['u'],
    replacement: (content) => (content ? `<u>${content}</u>` : ''),
  })

  service.addRule('scripts', {
    filter: ['sup', 'sub'],
    replacement: (content, node) => {
      if (!content) return ''

      const tag = node.nodeName.toLowerCase()
      const marker = tag === 'sup' ? '^' : '~'
      const holds = !content.includes(marker) && !/^\s|\s$/.test(content)

      return holds ? `${marker}${content}${marker}` : `<${tag}>${content}</${tag}>`
    },
  })

  service.addRule('cell', {
    filter: ['th', 'td'],
    replacement: (content, node) => {
      const said = content
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
      const first = (node as Element).previousElementSibling === null
      const table = (node as Element).closest('table')
      const held = table ? (gapsOf(table).before.get(node) ?? 0) : 0

      return `${first ? '|' : ''}${'  |'.repeat(held)} ${said} |${'  |'.repeat(spanOf(node) - 1)}`
    },
  })

  service.addRule('row', {
    filter: 'tr',
    replacement: (content, node) => {
      const row = node as HTMLTableRowElement
      const table = row.closest('table')
      const heading = table !== null && table.rows[0] === row && headed(table)
      const after = table ? (gapsOf(table).after.get(row) ?? 0) : 0
      if (!heading) return `\n${content}${'  |'.repeat(after)}`

      const borders = [...row.cells].flatMap((one) => {
        const align = (one.getAttribute('align') ?? '').toLowerCase()
        const border = ALIGNED[align] ?? '---'
        return Array.from({ length: spanOf(one) }, () => border)
      })
      return `\n${content}\n| ${borders.join(' | ')} |`
    },
  })

  service.addRule('table', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (content, node) => {
      const rows = content.replace(/^\n+/, '').trimEnd()
      if (!rows) return ''
      if (headed(node as HTMLTableElement)) return `\n\n${rows}\n\n`

      return `\n\n${emptyHeading(node as HTMLTableElement)}\n${rows}\n\n`
    },
  })

  service.addRule('preformatted', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = preformattedText(node).replace(/\n+$/, '')
      if (!code.trim()) return ''

      const fence = fenceFor(code)
      return `\n\n${fence}${languageOf(node)}\n${code}\n${fence}\n\n`
    },
  })

  service.addRule('maths', {
    filter: (node) => saysAFormula(node),
    replacement: (content, node) => {
      const tex = texOf(node)
      if (!tex) return content

      if (standsAlone(node)) return `\n\n$$\n${tex}\n$$\n\n`

      return `$${tex.replace(/(?<!\\)\$/g, '\\$')}$`
    },
  })

  service.addRule('link', {
    filter: (node) => {
      const href = node.nodeName === 'A' ? node.getAttribute('href') : null
      if (!href) return false
      if (mayPointAt(href, options)) insideLinks += 1
      return true
    },
    replacement: (content, node) => {
      const href = node.getAttribute('href') ?? ''
      if (mayPointAt(href, options)) insideLinks -= 1
      if (!mayPointAt(href, options)) return content

      const target = `${destination(href)}${titleOf(node)}`
      if (content.includes('\n\n') || node.querySelector(BLOCKS)) {
        return linkedBlocks(content, target)
      }

      return `[${content}](${target})`
    },
  })

  service.addRule('tag', {
    filter: (node) => {
      const words = node.textContent
      return node.classList.contains('tag') && tagNameAt(words, 0) === words.slice(1)
    },
    replacement: (_content, node) => node.textContent,
  })

  service.addRule('picture', {
    filter: 'img',
    replacement: (_content, node) => {
      const source = node.getAttribute('src') ?? ''
      if (!source || !mayPointAt(source, options, true)) return ''

      const alt = altOf(node)
      return `![${alt}](${destination(options.image ? options.image(source, alt) : source)})`
    },
  })

  return service
}

function tidy(markdown: string): string {
  const kept: string[] = []
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    if (fence !== null) {
      kept.push(line)
      if (new RegExp(`^\\s*${fence}\`*\\s*$`).test(line)) fence = null
      continue
    }

    fence = /^\s*(`{3,})/.exec(line)?.[1] ?? null

    const tidied = line.replace(/^[ \t]+$/, '')
    if (fence === null && tidied === '' && kept.at(-1) === '') continue
    kept.push(tidied)
  }

  return kept.join('\n').trim()
}

export function htmlToMarkdown(html: string, options: FromHtmlOptions = {}): string {
  if (!html.trim()) return ''
  return tidy(converter(options).turndown(html))
}
