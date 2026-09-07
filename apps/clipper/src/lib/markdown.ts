/** HTML into the markdown Nib writes.
 *
 *  Turndown does the work, with the GFM rules on top for tables, task lists and
 *  strikethrough, and the markers set to the ones the editor's own formatting
 *  commands produce: `**bold**`, `*italic*`, `-` bullets, `#` headings, fenced
 *  code. A note clipped here and a note typed in the app should be the same
 *  kind of file.
 *
 *  Pictures come out as placeholders rather than addresses. Their bytes are not
 *  here yet: the service worker fetches them and uploads them to the account,
 *  and only then is there a blob to point at. So the converter numbers them and
 *  `fill` puts the addresses in, once for the preview and again for the note
 *  that is saved. */

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { NEVER } from './elements'
import { PLACEHOLDER } from './placeholders'

export interface Converted {
  markdown: string
  /** Where each picture is now, in the order the placeholders name them. */
  images: string[]
}

/** A fence long enough to hold the code, whatever backticks the code contains. */
function fenceFor(code: string): string {
  const longest = [...code.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The language a code block names, from the class either half of it carries.
 *  `language-ts` is the convention; `lang-ts` is the older spelling, and both
 *  turn up on the same sites. */
function languageOf(pre: Element): string {
  const code = pre.querySelector('code')
  const classes = `${pre.className} ${code?.className ?? ''}`
  return /(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? ''
}

/** Alt text that cannot break out of its own brackets. */
function altOf(image: Element): string {
  return (image.getAttribute('alt') ?? '')
    .replace(/\s+/g, ' ')
    .replace(/([[\]])/g, '\\$1')
    .trim()
}

function converter(images: string[]): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  service.use(gfm)

  // A second line of defence behind `extract.ts`, which normally has taken
  // these out already. Without it, an element that reached here another way
  // would arrive as a paragraph of its own source. A filter rather than the
  // list itself, because `svg` is not an HTML tag and the list is.
  service.remove((node) => NEVER.includes(node.nodeName.toLowerCase()))

  // A list item, with one space after its marker rather than turndown's three.
  // Nib writes `- item`, and a note full of `-   item` is a note that looks
  // like it came from somewhere else. Nested lines line up under the text,
  // which is what makes the nesting readable in the source.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode as Element | null
      const ordered = parent?.nodeName === 'OL'
      const from = Number(parent?.getAttribute('start') ?? 1) || 1
      const at = parent ? [...parent.children].indexOf(node) : 0

      const marker = ordered ? `${from + at}.` : (options.bulletListMarker ?? '-')
      const indent = ' '.repeat(marker.length + 1)

      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, `\n${indent}`)
        // A ticked item brings its box and the space the page had after it;
        // one space between the box and the words is what markdown wants.
        .replace(/^(\[[ x]\])\s*/, '$1 ')

      const ends = node.nextSibling && !body.endsWith('\n') ? '\n' : ''
      return `${marker} ${body}${ends}`
    },
  })

  // GitHub's own spelling, which is the one the editor's format bar writes.
  // The plugin still says `~single~`, which most readers show as plain text.
  service.addRule('struck', {
    filter: ['del', 's'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  })

  // One rule for every preformatted block, whether or not it wraps a `code`.
  // Turndown's own fenced rule wants the pair, and a bare `pre` would otherwise
  // come out as a paragraph with its indentation collapsed.
  service.addRule('preformatted', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.textContent.replace(/\n+$/, '')
      if (!code.trim()) return ''

      const fence = fenceFor(code)
      return `\n\n${fence}${languageOf(node)}\n${code}\n${fence}\n\n`
    },
  })

  service.addRule('picture', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = node.getAttribute('src') ?? ''
      if (!src) return ''

      // The same picture twice in one article is one upload and one blob.
      let index = images.indexOf(src)
      if (index === -1) index = images.push(src) - 1

      return `![${altOf(node)}](${PLACEHOLDER}${index})`
    },
  })

  return service
}

/** Blank lines are how markdown separates blocks, and more than one of them
 *  says nothing extra. Trailing spaces on a line mean a hard break, so only the
 *  ones on otherwise empty lines go. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function toMarkdown(html: string): Converted {
  const images: string[] = []
  const markdown = html.trim() ? converter(images).turndown(html) : ''

  return { markdown: tidy(markdown), images }
}
