import { TreeFragment, type Input, type PartialParse, type Tree } from '@lezer/common'
import type { BlockContext, Element, Line, MarkdownConfig, MarkdownParser } from '@lezer/markdown'
import { BACKTICK, isSpace, TILDE } from './syntax'

/** Fenced code, with one deliberate departure from CommonMark: a fence that
 *  nothing closes is not a fence.
 *
 *  All of it is here rather than beside the other constructs because looking
 *  ahead for a closing fence is not something a block parser is meant to do,
 *  and doing it safely takes three things working together - a walk that puts
 *  the parser's line reader back where it found it, a note of every fence line
 *  that was turned down, and a cut to the fragments of the previous parse so
 *  such a line is never reused. Each of those is short; together they are the
 *  reason this is not a paragraph in constructs.ts. */

/** Where a line's opening fence ends, or -1 if it does not open one: three
 *  or more backticks or tildes, and for backticks an info string without any
 *  backtick in it. The same test the built-in parser uses. */
function fenceEnd(line: Line): number {
  if (line.next !== BACKTICK && line.next !== TILDE) return -1

  let pos = line.pos + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) === line.next) pos++
  if (pos < line.pos + 3) return -1
  if (line.next === BACKTICK && line.text.includes('`', pos)) return -1
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
    // Reading lines never pushes or pops the stack - only the parse loop does,
    // and it is not running here - so the same blocks are still there to write
    // back into. Written to defend against that changing rather than to fix a
    // shortened stack, which this could not put right anyway.
    blocks.forEach((block, i) => {
      const still = state.stack[i]
      if (still) Object.assign(still, block)
    })
  }
}

/** Adds code text, stretching the previous piece when it touches this one. */
function addCodeText(cx: BlockContext, marks: Element[], from: number, to: number) {
  const last = marks.at(-1)
  const name = last ? cx.parser.nodeSet.types[last.type]?.name : undefined
  if (last?.to === from && name === 'CodeText') {
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
function withoutUnclosedFences(
  fragments: readonly TreeFragment[],
  input: Input,
): readonly TreeFragment[] {
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
        out.push(
          new TreeFragment(
            from,
            blockFrom,
            tree,
            offset,
            from === fragment.from && fragment.openStart,
            true,
          ),
        )
      }
      from = blockTo
      changed = true
    }

    if (from === fragment.from) out.push(fragment)
    else if (from < fragment.to)
      out.push(new TreeFragment(from, fragment.to, tree, offset, true, fragment.openEnd))
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
const FencedCode: MarkdownConfig = {
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
        if (infoFrom < infoTo)
          marks.push(cx.elt('CodeInfo', cx.lineStart + infoFrom, cx.lineStart + infoTo))

        // The line breaks between code lines are code text too, the one after
        // the opener is not, and a block of nothing but blank lines still gets
        // one piece of code text - as the built-in parser has it.
        for (
          let first = true, empty = true, hasLine = false;
          cx.nextLine() && insideContainers(cx, line);
          first = false
        ) {
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

export { FencedCode }
