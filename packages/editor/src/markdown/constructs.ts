import type { Input } from '@lezer/common'
import { tags } from '@lezer/highlight'
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { parseWikilink, shownSpan } from '@orden/markdown/links'
import { tagAt } from '@orden/markdown/tags'
import { markTags } from './tags'
import {
  BACKSLASH,
  BANG,
  BRACKET_CLOSE,
  BRACKET_OPEN,
  CARET,
  DOLLAR,
  EQUALS,
  HASH,
  isDigit,
  isSpace,
  NEWLINE,
  PERCENT,
} from './syntax'

const COMMENT_DELIMITER = { resolve: 'PercentComment', mark: 'PercentCommentMark' }

const PercentComment: MarkdownConfig = {
  defineNodes: [
    { name: 'PercentComment', style: tags.comment },
    { name: 'PercentCommentMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'PercentComment',
      triggers: '%',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1
        return cx.addDelimiter(COMMENT_DELIMITER, pos, pos + 2, true, true)
      },
    },
  ],
}

const HIGHLIGHT_DELIMITER = { resolve: 'Highlight', mark: 'HighlightMark' }

const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: markTags.highlight },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      triggers: '=',
      after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) return -1
        return cx.addDelimiter(HIGHLIGHT_DELIMITER, pos, pos + 2, true, true)
      },
    },
  ],
}

const Wikilink: MarkdownConfig = {
  defineNodes: [{ name: 'Wikilink' }, { name: 'WikilinkMark', style: tags.processingInstruction }],
  parseInline: [
    {
      name: 'Wikilink',
      triggers: '![',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        if (!embed && next !== BRACKET_OPEN) return -1

        const open = embed ? pos + 1 : pos
        if (cx.char(open) !== BRACKET_OPEN || cx.char(open + 1) !== BRACKET_OPEN) return -1

        for (let i = open + 2; i < cx.end; i++) {
          const code = cx.char(i)
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

const Hashtag: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: markTags.hashtag }],
  parseInline: [
    {
      name: 'Hashtag',
      triggers: '#',
      parse(cx, next, pos) {
        if (next !== HASH) return -1

        const name = tagAt(cx.text, pos - cx.offset)
        if (name === null) return -1

        return cx.addElement(cx.elt('Hashtag', pos, pos + 1 + name.length))
      },
    },
  ],
}

interface Closing {
  from: number
  until: number
  at: number
}

const closings = new WeakMap<object, Closing>()

function closingDollar(cx: InlineContext, pos: number): number {
  const known = closings.get(cx)
  if (known && pos >= known.from && pos < known.until) return known.at

  for (let i = pos + 1; i < cx.end; i++) {
    const code = cx.char(i)
    if (code === NEWLINE) {
      closings.set(cx, { from: pos, until: i, at: -1 })
      return -1
    }
    if (code === BACKSLASH) {
      i++
      continue
    }
    if (code === DOLLAR && !isSpace(cx.char(i - 1))) {
      closings.set(cx, { from: pos, until: i, at: i })
      return i
    }
  }

  closings.set(cx, { from: pos, until: cx.end, at: -1 })
  return -1
}

const InlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: markTags.math },
    { name: 'MathMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      triggers: '$',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1
        if (isSpace(cx.char(pos + 1))) return -1

        const close = closingDollar(cx, pos)
        if (close < 0 || isDigit(cx.char(close + 1))) return -1

        return cx.addElement(
          cx.elt('InlineMath', pos, close + 1, [
            cx.elt('MathMark', pos, pos + 1),
            cx.elt('MathMark', close, close + 1),
          ]),
        )
      },
    },
  ],
}

const ONE_LINE = /^\$\$(?![\s$])[^\n]*?(?<![\s$])\$\$$/

const restOf = (line: Line) => line.text.slice(line.pos).trimEnd()

function opensBlockMath(rest: string): boolean {
  return ONE_LINE.test(rest) || rest.trim() === '$$'
}

const CLOSES_MATH = /^\$\$(?:[ \t]+\^[A-Za-z0-9-]+)?\s*$/

const BlockMath: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true, style: markTags.math }],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'HorizontalRule',

      endLeaf: (_cx: BlockContext, line: Line) =>
        line.next === DOLLAR && opensBlockMath(restOf(line)),

      parse(cx: BlockContext, line: Line) {
        const rest = restOf(line)

        if (ONE_LINE.test(rest)) {
          const at = cx.lineStart + line.pos
          const end = at + rest.length
          cx.addElement(
            cx.elt('BlockMath', at, end, [
              cx.elt('MathMark', at, at + 2),
              cx.elt('MathMark', end - 2, end),
            ]),
          )
          cx.nextLine()
          return true
        }

        if (rest.trim() !== '$$') return false

        const from = cx.lineStart + line.pos
        const marks = [cx.elt('MathMark', from, from + 2)]
        let to = from + 2

        while (cx.nextLine()) {
          if (CLOSES_MATH.test(line.text.slice(line.pos))) {
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
      triggers: '[',
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
        const { input } = cx as unknown as { input: Input }
        const block = frontMatterBlock(input.read(0, input.length))
        if (!block) return false

        const marks = [cx.elt('FrontMatterMark', block.from, block.from + 3)]
        let to = block.from + 3

        while (cx.nextLine()) {
          if (cx.lineStart === block.close) {
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

const DefinitionList: MarkdownConfig = {
  defineNodes: [
    { name: 'DefinitionDetail', block: true },
    { name: 'DefinitionMark', style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'DefinitionDetail',
      before: 'SetextHeading',
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
  Hashtag,
  Highlight,
  InlineMath,
  PercentComment,
  Wikilink,
}
