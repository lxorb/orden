import { TreeFragment, type Input, type PartialParse, type Tree } from '@lezer/common'
import { Tag, tags } from '@lezer/highlight'
import type { BlockContext, Element, Line, MarkdownConfig, MarkdownParser } from '@lezer/markdown'

const DOLLAR = 36
const BACKTICK = 96
const TILDE = 126
const EQUALS = 61
const BRACKET_OPEN = 91
const BRACKET_CLOSE = 93
const CARET = 94
const BACKSLASH = 92
const NEWLINE = 10

/** Tags for the constructs CommonMark and GFM do not define. */
export const markTags = {
  highlight: Tag.define(),
  math: Tag.define(),
  footnote: Tag.define(),
  frontMatter: Tag.define(),
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === NEWLINE || code === -1
}

// Lezer pairs opening and closing delimiters by object identity, so this has
// to be one shared instance rather than a literal built per call.
const HIGHLIGHT_DELIMITER = { resolve: 'Highlight', mark: 'HighlightMark' }

/** `==marked==`, Typora's highlight syntax. */
export const Highlight: MarkdownConfig = {
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

/** `$x$`. Requires non-space just inside the delimiters, so prices survive. */
export const InlineMath: MarkdownConfig = {
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
export const BlockMath: MarkdownConfig = {
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
export const Footnote: MarkdownConfig = {
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

        const from = cx.lineStart + line.pos
        const to = from + line.text.length - line.pos
        cx.addElement(
          cx.elt('FootnoteDef', from, to, [
            cx.elt('FootnoteMark', from, from + 2),
            cx.elt('FootnoteLabel', from + 2, from + 2 + match[1].length),
            cx.elt('FootnoteMark', from + 2 + match[1].length, from + match[0].length),
          ]),
        )
        cx.nextLine()
        return true
      },
    },
  ],
}

/** YAML metadata fenced by `---`, only at the very top of a document. */
export const FrontMatter: MarkdownConfig = {
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
export const DefinitionList: MarkdownConfig = {
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

        cx.addElement(cx.elt('DefinitionDetail', from, to, [cx.elt('DefinitionMark', from, from + 1)]))
        cx.nextLine()
        return true
      },
    },
  ],
}

/** `*[HTML]: HyperText Markup Language` - a definition, never shown as prose. */
export const Abbreviation: MarkdownConfig = {
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

        const from = cx.lineStart + line.pos
        const to = cx.lineStart + line.text.length

        cx.addElement(
          cx.elt('AbbrevDef', from, to, [
            cx.elt('AbbrevMark', from, from + 2),
            cx.elt('AbbrevLabel', from + 2, from + 2 + match[1].length),
            cx.elt('AbbrevMark', from + 2 + match[1].length, from + match[0].length),
          ]),
        )
        cx.nextLine()
        return true
      },
    },
  ],
}

/** Where a line's opening fence ends, or -1 if it does not open one: three
 *  or more backticks or tildes, and for backticks an info string without any
 *  backtick in it. The same test the built-in parser uses. */
function fenceEnd(line: Line): number {
  if (line.next !== BACKTICK && line.next !== TILDE) return -1

  let pos = line.pos + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) === line.next) pos++
  if (pos < line.pos + 3) return -1
  if (line.next === BACKTICK && line.text.indexOf('`', pos) >= 0) return -1
  return pos
}

/** Where a line's closing fence ends, or -1: the opener's character, at least
 *  as many of them, at most three spaces in, and nothing else on the line. */
function closerEnd(line: Line, mark: number, length: number): number {
  let pos = line.pos
  if (line.indent - line.baseIndent < 4) {
    while (pos < line.text.length && line.text.charCodeAt(pos) === mark) pos++
  }
  return pos - line.pos >= length && line.skipSpace(pos) === line.text.length ? pos : -1
}

/** Whether the current line is still inside every block the fence opened in.
 *  The line's depth is not part of lezer-markdown's public types, but it is
 *  the only record of a container ending, and the built-in parser reads it
 *  the same way. */
function insideContainers(cx: BlockContext, line: Line): boolean {
  return (line as Line & { depth: number }).depth >= cx.depth
}

/** The private state `nextLine` writes to: the context's own position
 *  bookkeeping, the one `Line` object it fills in, and the `end` of each
 *  open container block on its stack. */
interface LineReadingState {
  line: Line
  stack: object[]
}

/** Whether a closing fence follows before the enclosing block ends.
 *
 *  A block parser can only read forward, and `peekLine` reaches one line
 *  ahead, so this walks ahead with `nextLine` and afterwards puts back
 *  everything it moved. Doing it with the parser's own line reader is what
 *  keeps the container rules exact: a fence in a list item or a blockquote
 *  ends where the item or quote ends, and that is decided by lezer-markdown's
 *  markup skipping, which is not something to reimplement here. */
function closerAhead(cx: BlockContext, line: Line, mark: number, length: number): boolean {
  const state = cx as unknown as LineReadingState
  const context = { ...state }
  const { markers, ...fields } = state.line
  const savedMarkers = markers.slice()
  const blocks = state.stack.map((block) => ({ ...block }))

  try {
    while (cx.nextLine() && insideContainers(cx, line)) {
      if (closerEnd(line, mark, length) >= 0) return true
    }
    return false
  } finally {
    Object.assign(state, context)
    Object.assign(state.line, fields)
    state.line.markers.length = 0
    state.line.markers.push(...savedMarkers)
    blocks.forEach((block, i) => Object.assign(state.stack[i], block))
  }
}

/** Adds code text, stretching the previous piece when it touches this one. */
function addCodeText(cx: BlockContext, marks: Element[], from: number, to: number) {
  const last = marks[marks.length - 1]
  if (last && last.to === from && cx.parser.nodeSet.types[last.type].name === 'CodeText') {
    marks[marks.length - 1] = cx.elt('CodeText', last.from, to)
  } else {
    marks.push(cx.elt('CodeText', from, to))
  }
}

/** Whether a block's first characters open a fence. */
function opensFence(node: { from: number; to: number }, input: Input): boolean {
  if (node.to - node.from < 3) return false
  const start = input.read(node.from, node.from + 3)
  return start === '```' || start === '~~~'
}

/** Where a parse turned down a fence for want of a closer, by the tree that
 *  parse produced. Those lines are the only blocks a later edit can turn into
 *  fenced code, so knowing them means never having to look for them: reading
 *  every block of a tree costs as much as the size of the note, on a keystroke
 *  that changed one character. A tree that was parsed before this was recorded
 *  - the first one, or one from a parse configured elsewhere - is walked once
 *  and remembered here as well. */
const openFences = new WeakMap<Tree, readonly number[]>()

/** The parse currently advancing, or null between parses. Set around each
 *  `advance` rather than for the parse's lifetime, because parses of different
 *  documents take turns in idle time. */
let declining: number[] | null = null

/** Follows a parse so that what it turned down can be filed under the tree it
 *  ends up producing. */
function watchDeclines(parse: PartialParse): PartialParse {
  const found: number[] = []

  return {
    get parsedPos() {
      return parse.parsedPos
    },
    get stoppedAt() {
      return parse.stoppedAt
    },
    stopAt(pos: number) {
      parse.stopAt(pos)
    },
    advance() {
      const outer = declining
      declining = found
      try {
        const tree = parse.advance()
        if (tree) openFences.set(tree, found)
        return tree
      } finally {
        declining = outer
      }
    },
  }
}

/** Every block of `tree` that opens a fence without being fenced code, for a
 *  tree whose own parse did not say. */
function scanForOpenFences(tree: Tree, input: Input): readonly number[] {
  const found: number[] = []

  tree.iterate({
    enter(node) {
      if (!node.type.is('Block')) return false
      if (!node.type.is('LeafBlock')) return true
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
      if (opensFence(node, input)) found.push(node.from)
      return false
    },
  })

  openFences.set(tree, found)
  return found
}

/** The leaf block holding `pos`, so a fragment can be cut around the whole of
 *  it rather than at the line it starts on. */
function leafBlockAt(tree: Tree, pos: number): { from: number; to: number } {
  let node = tree.resolveInner(pos, 1)
  while (!node.type.is('LeafBlock') && node.parent) node = node.parent
  return { from: node.from, to: node.to }
}

/** The fragments of an earlier parse, cut so that no block which opens a
 *  fence without being fenced code is kept from it.
 *
 *  An edit re-parses only what it touched; the blocks around it come back
 *  from the previous tree. That is sound as long as a block's parse depends
 *  on nothing beyond its own end, and a fence line nothing closed is the one
 *  block that breaks the rule: it became a paragraph because of what was not
 *  below it, so typing its closer far down would leave the paragraph in
 *  place, reused, with no way for the parser to know. Leaving such blocks
 *  out of the fragments makes the parser look at them again every time,
 *  which is cheap - there is rarely more than the one being typed. */
function withoutUnclosedFences(fragments: readonly TreeFragment[], input: Input): readonly TreeFragment[] {
  const out: TreeFragment[] = []
  let changed = false

  for (const fragment of fragments) {
    const { tree, offset } = fragment
    const open = openFences.get(tree) ?? scanForOpenFences(tree, input)
    let from = fragment.from

    for (const position of open) {
      const block = leafBlockAt(tree, position)
      // Tree positions are the document's plus the offset.
      const blockFrom = block.from - offset
      const blockTo = block.to - offset
      if (blockFrom < from || blockTo > fragment.to) continue

      if (blockFrom > from) {
        out.push(new TreeFragment(from, blockFrom, tree, offset, from === fragment.from && fragment.openStart, true))
      }
      from = blockTo
      changed = true
    }

    if (from === fragment.from) out.push(fragment)
    else if (from < fragment.to) out.push(new TreeFragment(from, fragment.to, tree, offset, true, fragment.openEnd))
  }

  return changed ? out : fragments
}

/** The block parser behind a parse. `wrap` is handed the parse after
 *  lang-markdown's nested-language wrapper has been put around it, and that
 *  wrapper keeps the block parser as its `baseParse`; a parse without either
 *  cannot be rebuilt, and is left as it is. */
function parserOf(parse: PartialParse): MarkdownParser | null {
  const own = (parse as { parser?: MarkdownParser }).parser
  if (own) return own
  return (parse as { baseParse?: { parser?: MarkdownParser } }).baseParse?.parser ?? null
}

/** Fragment lists this module already cut, so rebuilding a parse with them
 *  does not cut them again. */
const alreadyCut = new WeakSet<readonly TreeFragment[]>()

/** Fenced code, with one deliberate departure from CommonMark: a fence that
 *  nothing closes is not a fence.
 *
 *  CommonMark runs an unclosed fence to the end of its container, so the
 *  moment the third backtick is typed the whole rest of the note turns into
 *  code. The headings, emphasis and images below do not merely lose their
 *  styling, they lose their nodes, so the live preview cannot paper over it;
 *  the fix has to be in the parser. This takes the slot of lezer-markdown's
 *  built-in `FencedCode` (a `parseBlock` entry with the same name replaces
 *  it) and looks ahead for a closing fence before committing. Finding none it
 *  declines, and the line is an ordinary paragraph until a closer is typed
 *  below, or Enter puts one there (`closeFence` in commands.ts).
 *
 *  The same holds inside list items and blockquotes, where CommonMark would
 *  let the container's end close the fence: here such a fence stays a
 *  paragraph until it is closed within the container. Everything else - the
 *  fence characters, the indent allowed, the info string, where a container
 *  ends, and the nodes produced - follows the built-in parser line by line,
 *  so nested language highlighting and the fence rendering keep working. */
export const FencedCode: MarkdownConfig = {
  // Rebuilds a parse that would reuse an unclosed fence line from before an
  // edit; see `withoutUnclosedFences`. A parse is created and wrapped before
  // this sees it, so a cut fragment list means starting the parse over.
  wrap(inner, input, fragments, ranges) {
    if (alreadyCut.has(fragments)) return inner
    if (fragments.length === 0) return watchDeclines(inner)

    const cut = withoutUnclosedFences(fragments, input)
    if (cut === fragments) return watchDeclines(inner)

    const parser = parserOf(inner)
    if (!parser) return watchDeclines(inner)

    alreadyCut.add(cut)
    return watchDeclines(parser.startParse(input, cut, ranges))
  },
  parseBlock: [
    {
      name: 'FencedCode',
      parse(cx: BlockContext, line: Line) {
        const end = fenceEnd(line)
        if (end < 0) return false

        const mark = line.next
        const length = end - line.pos
        if (!closerAhead(cx, line, mark, length)) {
          // Turned down for want of a closer, which makes this the one line an
          // edit anywhere below could still turn into a fence. Written down so
          // the next parse can cut its fragments here without having to read
          // every block of the note looking for lines like it.
          declining?.push(cx.lineStart + line.pos)
          return false
        }

        const from = cx.lineStart + line.pos
        const infoFrom = line.skipSpace(end)
        let infoTo = line.text.length
        while (infoTo > infoFrom && isSpace(line.text.charCodeAt(infoTo - 1))) infoTo--

        const marks: Element[] = [cx.elt('CodeMark', from, from + length)]
        if (infoFrom < infoTo) marks.push(cx.elt('CodeInfo', cx.lineStart + infoFrom, cx.lineStart + infoTo))

        // The line breaks between code lines are code text too, the one after
        // the opener is not, and a block of nothing but blank lines still gets
        // one piece of code text - as the built-in parser has it.
        for (let first = true, empty = true, hasLine = false; cx.nextLine() && insideContainers(cx, line); first = false) {
          const closer = closerEnd(line, mark, length)
          if (closer >= 0) {
            marks.push(...line.markers)
            if (empty && hasLine) addCodeText(cx, marks, cx.lineStart - 1, cx.lineStart)
            marks.push(cx.elt('CodeMark', cx.lineStart + line.pos, cx.lineStart + closer))
            cx.nextLine()
            break
          }

          hasLine = true
          if (!first) {
            addCodeText(cx, marks, cx.lineStart - 1, cx.lineStart)
            empty = false
          }
          marks.push(...line.markers)
          const textFrom = cx.lineStart + line.basePos
          const textTo = cx.lineStart + line.text.length
          if (textFrom < textTo) {
            addCodeText(cx, marks, textFrom, textTo)
            empty = false
          }
        }

        cx.addElement(cx.elt('FencedCode', from, cx.prevLineEnd(), marks))
        return true
      },
    },
  ],
}

export const nibMarkdownExtensions = [
  Highlight,
  InlineMath,
  BlockMath,
  Footnote,
  FrontMatter,
  DefinitionList,
  Abbreviation,
  FencedCode,
]
