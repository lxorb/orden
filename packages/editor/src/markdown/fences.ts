import { TreeFragment, type Input, type PartialParse, type Tree } from '@lezer/common'
import type { BlockContext, Element, Line, MarkdownConfig, MarkdownParser } from '@lezer/markdown'
import { fenceName } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { enclosing } from '../nodes'
import { BACKTICK, isSpace, TILDE } from './syntax'

function fenceEnd(line: Line): number {
  if (line.next !== BACKTICK && line.next !== TILDE) return -1

  let pos = line.pos + 1
  while (pos < line.text.length && line.text.charCodeAt(pos) === line.next) pos++
  if (pos < line.pos + 3) return -1
  if (line.next === BACKTICK && line.text.includes('`', pos)) return -1
  return pos
}

function closerEnd(line: Line, mark: number, length: number): number {
  let pos = line.pos
  if (line.indent - line.baseIndent < 4) {
    while (pos < line.text.length && line.text.charCodeAt(pos) === mark) pos++
  }
  if (pos - line.pos < length) return -1
  if (line.skipSpace(pos) === line.text.length) return pos
  return fenceName(line.text.slice(line.pos)) === null ? -1 : line.text.trimEnd().length
}

function insideContainers(cx: BlockContext, line: Line): boolean {
  return (line as Line & { depth: number }).depth >= cx.depth
}

interface LineReadingState {
  line: Line
  stack: object[]
}

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
    blocks.forEach((block, i) => {
      const still = state.stack[i]
      if (still) Object.assign(still, block)
    })
  }
}

function addCodeText(cx: BlockContext, marks: Element[], from: number, to: number) {
  const last = marks.at(-1)
  const name = last ? cx.parser.nodeSet.types[last.type]?.name : undefined
  if (last?.to === from && name === 'CodeText') {
    marks[marks.length - 1] = cx.elt('CodeText', last.from, to)
  } else {
    marks.push(cx.elt('CodeText', from, to))
  }
}

function opensFence(node: { from: number; to: number }, input: Input): boolean {
  if (node.to - node.from < 3) return false
  const start = input.read(node.from, node.from + 3)
  return start === '```' || start === '~~~'
}

const openFences = new WeakMap<Tree, readonly number[]>()

let declining: number[] | null = null

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

function leafBlockAt(tree: Tree, pos: number): { from: number; to: number } {
  let found = tree.resolveInner(pos, 1)
  for (const node of enclosing(found)) {
    found = node
    if (node.type.is('LeafBlock')) break
  }

  return { from: found.from, to: found.to }
}

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

function withoutFrontMatter(
  fragments: readonly TreeFragment[],
  input: Input,
): readonly TreeFragment[] {
  const opening = input.read(0, Math.min(4, input.length))
  if (!opening.startsWith('---') && !opening.startsWith('\uFEFF---')) return fragments

  const text = input.read(0, input.length)
  const line = text.indexOf('\n')
  const to = frontMatterBlock(text)?.to ?? (line === -1 ? text.length : line + 1)

  const out: TreeFragment[] = []
  for (const fragment of fragments) {
    if (fragment.from >= to) out.push(fragment)
    else if (fragment.to > to) {
      out.push(
        new TreeFragment(to, fragment.to, fragment.tree, fragment.offset, true, fragment.openEnd),
      )
    }
  }
  return out
}

function parserOf(parse: PartialParse): MarkdownParser | null {
  const own = (parse as { parser?: MarkdownParser }).parser
  if (own) return own
  return (parse as { baseParse?: { parser?: MarkdownParser } }).baseParse?.parser ?? null
}

const alreadyCut = new WeakSet<readonly TreeFragment[]>()

const FencedCode: MarkdownConfig = {
  wrap(inner, input, fragments, ranges) {
    if (alreadyCut.has(fragments)) return inner
    if (fragments.length === 0) return watchDeclines(inner)

    const cut = withoutUnclosedFences(withoutFrontMatter(fragments, input), input)
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
