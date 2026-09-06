import { tags } from '@lezer/highlight'
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'
import { parseWikilink, shownSpan } from '@nib/markdown/links'
import { markTags } from './tags'
import {
  BACKSLASH,
  BANG,
  BRACKET_CLOSE,
  BRACKET_OPEN,
  CARET,
  DOLLAR,
  EQUALS,
  isSpace,
  NEWLINE,
} from './syntax'

/** The constructs Typora writes that CommonMark and GFM do not have: a
 *  highlight, inline and display maths, footnotes, YAML front matter, a
 *  definition list, an abbreviation definition, and Obsidian's wikilinks.
 *
 *  Each is a `MarkdownConfig` naming the nodes it defines and one parser for
 *  them, which is all lezer-markdown needs to be taught a construct. Fenced code
 *  is the only one with enough machinery to want a file of its own, and has one:
 *  fences.ts.
 *
 *  Read alongside live-preview/decorate.ts, which decides what each of these
 *  nodes looks like once it is parsed. */

// Lezer pairs opening and closing delimiters by object identity, so this has
// to be one shared instance rather than a literal built per call.
const HIGHLIGHT_DELIMITER = { resolve: 'Highlight', mark: 'HighlightMark' }

/** `==marked==`, Typora's highlight syntax. */
const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: markTags.highlight },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1
        return cx.addDelimiter(HIGHLIGHT_DELIMITER, pos, pos + 2, true, true)
      },
    },
  ],
}

/** `[[Note]]`, `[[Note|shown text]]`, `[[Note#Heading]]`, `[[Note#^blockid]]`,
 *  and `![[Note]]` for the note's content rather than a link to it.
 *
 *  Two marks and nothing between them, on purpose: the first covers everything
 *  ahead of the words a reader sees - the brackets, the target and the bar of an
 *  aliased link - and the second covers everything after. So the preview hides
 *  both the way it hides any other syntax mark, the text left showing is exactly
 *  what the link says, and a click beside it snaps outside the whole link
 *  (see live-preview/snap.ts). Where the shown part starts and ends is decided
 *  by `shownSpan`, which is also what the renderer reads: one grammar. */
const Wikilink: MarkdownConfig = {
  defineNodes: [{ name: 'Wikilink' }, { name: 'WikilinkMark', style: tags.processingInstruction }],
  parseInline: [
    {
      name: 'Wikilink',
      // Ahead of `Link` and of `Image`, either of which would otherwise claim
      // the brackets and leave a link inside a link.
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        if (!embed && next !== BRACKET_OPEN) return -1

        const open = embed ? pos + 1 : pos
        if (cx.char(open) !== BRACKET_OPEN || cx.char(open + 1) !== BRACKET_OPEN) return -1

        for (let i = open + 2; i < cx.end; i++) {
          const code = cx.char(i)
          // A link holds one line and no brackets of its own, which is where
          // Obsidian ends one too.
          if (code === NEWLINE || code === BRACKET_OPEN) return -1
          if (code !== BRACKET_CLOSE) continue
          if (cx.char(i + 1) !== BRACKET_CLOSE) return -1

          const from = open + 2
          const inner = cx.slice(from, i)
          if (!parseWikilink(inner, embed)) return -1

          const shown = shownSpan(inner)
          const to = i + 2

          return cx.addElement(
            cx.elt('Wikilink', pos, to, [
              cx.elt('WikilinkMark', pos, from + shown.from),
              cx.elt('WikilinkMark', from + shown.to, to),
            ]),
          )
        }

        return -1
      },
    },
  ],
}

/** `$x$`. Requires non-space just inside the delimiters, so prices survive. */
const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: markTags.math },
    { name: 'MathMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1
        if (isSpace(cx.char(pos + 1))) return -1

        for (let i = pos + 1; i < cx.end; i++) {
          const code = cx.char(i)
          if (code === NEWLINE) return -1
          if (code === BACKSLASH) {
            i++
            continue
          }
          if (code === DOLLAR && !isSpace(cx.char(i - 1))) {
            return cx.addElement(
              cx.elt('InlineMath', pos, i + 1, [
                cx.elt('MathMark', pos, pos + 1),
                cx.elt('MathMark', i, i + 1),
              ]),
            )
          }
        }
        return -1
      },
    },
  ],
}

/** A `$$` fence on its own line, closed by another. */
const BlockMath: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true, style: markTags.math }],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (line.text.slice(line.pos).trim() !== '$$') return false

        const from = cx.lineStart + line.pos
        const marks = [cx.elt('MathMark', from, from + 2)]
        let to = from + 2

        while (cx.nextLine()) {
          if (line.text.slice(line.pos).trim() === '$$') {
            const close = cx.lineStart + line.pos
            marks.push(cx.elt('MathMark', close, close + 2))
            to = close + 2
            cx.nextLine()
            break
          }
          to = cx.lineStart + line.text.length
        }

        cx.addElement(cx.elt('BlockMath', from, to, marks))
        return true
      },
    },
  ],
}

/** `[^id]` in the text and `[^id]: …` at the bottom. */
const Footnote: MarkdownConfig = {
  defineNodes: [
    { name: 'FootnoteRef', style: markTags.footnote },
    { name: 'FootnoteDef', block: true },
    { name: 'FootnoteMark', style: tags.processingInstruction },
    { name: 'FootnoteLabel', style: tags.labelName },
  ],
  parseInline: [
    {
      name: 'FootnoteRef',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== CARET) return -1

        for (let i = pos + 2; i < cx.end; i++) {
          const code = cx.char(i)
          if (code === NEWLINE || code === BRACKET_OPEN) return -1
          if (code === BRACKET_CLOSE) {
            if (i === pos + 2) return -1
            return cx.addElement(
              cx.elt('FootnoteRef', pos, i + 1, [
                cx.elt('FootnoteMark', pos, pos + 2),
                cx.elt('FootnoteLabel', pos + 2, i),
                cx.elt('FootnoteMark', i, i + 1),
              ]),
            )
          }
        }
        return -1
      },
    },
  ],
  parseBlock: [
    {
      name: 'FootnoteDef',
      before: 'LinkReference',
      parse(cx: BlockContext, line: Line) {
        const match = /^\[\^([^\]\s]+)\]:/.exec(line.text.slice(line.pos))
        if (!match) return false

        const [whole, label = ''] = match
        const from = cx.lineStart + line.pos
        const to = from + line.text.length - line.pos
        cx.addElement(
          cx.elt('FootnoteDef', from, to, [
            cx.elt('FootnoteMark', from, from + 2),
            cx.elt('FootnoteLabel', from + 2, from + 2 + label.length),
            cx.elt('FootnoteMark', from + 2 + label.length, from + whole.length),
          ]),
        )
        cx.nextLine()
        return true
      },
    },
  ],
}

/** YAML metadata fenced by `---`, only at the very top of a document. */
const FrontMatter: MarkdownConfig = {
  defineNodes: [
    { name: 'FrontMatter', block: true, style: markTags.frontMatter },
    { name: 'FrontMatterMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || line.text.trim() !== '---') return false
        // A document may legitimately open with a horizontal rule. Require the
        // next line to look like YAML before committing, since a block parser
        // cannot rewind once it has consumed lines.
        if (!/^\s*[\w.$-]+\s*:/.test(cx.peekLine())) return false

        const marks = [cx.elt('FrontMatterMark', 0, 3)]
        let to = 3

        while (cx.nextLine()) {
          if (line.text.trim() === '---') {
            marks.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3))
            to = cx.lineStart + 3
            cx.nextLine()
            break
          }
          to = cx.lineStart + line.text.length
        }

        cx.addElement(cx.elt('FrontMatter', 0, to, marks))
        return true
      },
    },
  ],
}

/** `: a meaning` under the term it belongs to. */
const DefinitionList: MarkdownConfig = {
  defineNodes: [
    { name: 'DefinitionDetail', block: true },
    { name: 'DefinitionMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'DefinitionDetail',
      before: 'SetextHeading',
      // The term above is a paragraph, and a paragraph swallows the lines that
      // follow it. This ends it so the definition can be parsed on its own.
      endLeaf(_cx: BlockContext, line: Line) {
        return /^:[ \t]+\S/.test(line.text.slice(line.pos))
      },
      parse(cx: BlockContext, line: Line) {
        const match = /^:[ \t]+\S/.exec(line.text.slice(line.pos))
        if (!match) return false

        const from = cx.lineStart + line.pos
        const to = cx.lineStart + line.text.length

        cx.addElement(
          cx.elt('DefinitionDetail', from, to, [cx.elt('DefinitionMark', from, from + 1)]),
        )
        cx.nextLine()
        return true
      },
    },
  ],
}

/** `*[HTML]: HyperText Markup Language` - a definition, never shown as prose. */
const Abbreviation: MarkdownConfig = {
  defineNodes: [
    { name: 'AbbrevDef', block: true },
    { name: 'AbbrevMark', style: tags.processingInstruction },
    { name: 'AbbrevLabel', style: tags.labelName },
  ],
  parseBlock: [
    {
      name: 'AbbrevDef',
      before: 'LinkReference',
      endLeaf(_cx: BlockContext, line: Line) {
        return /^\*\[[^\]\n]+\]:/.test(line.text.slice(line.pos))
      },
      parse(cx: BlockContext, line: Line) {
        const match = /^\*\[([^\]\n]+)\]:/.exec(line.text.slice(line.pos))
        if (!match) return false

        const [whole, label = ''] = match
        const from = cx.lineStart + line.pos
        const to = cx.lineStart + line.text.length

        cx.addElement(
          cx.elt('AbbrevDef', from, to, [
            cx.elt('AbbrevMark', from, from + 2),
            cx.elt('AbbrevLabel', from + 2, from + 2 + label.length),
            cx.elt('AbbrevMark', from + 2 + label.length, from + whole.length),
          ]),
        )
        cx.nextLine()
        return true
      },
    },
  ],
}

export {
  Abbreviation,
  BlockMath,
  DefinitionList,
  Footnote,
  FrontMatter,
  Highlight,
  InlineMath,
  Wikilink,
}
