import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type WidgetType,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { concealable, hide, meta } from './conceal'
import { numberEquations } from './blocks'
import { dragging } from './dragging'
import { lineRevealed, noReveal, overlaps, revealed } from './reveal'
import { DIAGRAM_LANGUAGES, MathWidget } from './render'
import { emojiFor } from '../emoji'
import { fenceCode, fenceLanguage } from '../fence'
import { hrefOf, linkTitle } from '../links'
import { ImageWidget, imageOfNode, imageRevealed } from './image'
import {
  BulletWidget,
  CalloutWidget,
  CheckboxWidget,
  EmojiWidget,
  FenceHeaderWidget,
  PageBreakWidget,
  RuleWidget,
} from './widgets'

const HEADING = /^(?:ATX|Setext)Heading(\d)$/
const CALLOUT = /^>\s*\[!(note|tip|important|warning|caution)\]/i

const LINE_CLASS: Record<string, string> = {
  CodeBlock: 'nib-code',
  Table: 'nib-table',
  FrontMatter: 'nib-frontmatter',
  FootnoteDef: 'nib-footnote',
  DefinitionDetail: 'nib-definition',
  AbbrevDef: 'nib-abbrev',
}

class Decorator {
  private readonly marks: Range<Decoration>[] = []
  private readonly hidden: Range<Decoration>[] = []
  private readonly lineClasses = new Map<number, Set<string>>()
  /** Spans already replaced wholesale. Nested syntax inside them must not be
   *  decorated again, or the two replacements would overlap and throw. */
  private readonly claimed: { from: number; to: number }[] = []

  constructor(private readonly state: EditorState) {}

  build(ranges: readonly { from: number; to: number }[]) {
    for (const { from, to } of ranges) {
      syntaxTree(this.state).iterate({ from, to, enter: (node) => this.visit(node.node) })
    }

    const lines: Range<Decoration>[] = []
    for (const [pos, classes] of this.lineClasses) {
      lines.push(Decoration.line({ class: [...classes].join(' ') }).range(pos))
    }

    return {
      decorations: Decoration.set([...lines, ...this.marks, ...this.hidden], true),
      // Only concealed text is atomic, so the caret steps over hidden syntax
      // instead of landing inside it. Visible marks stay freely editable.
      atomic: Decoration.set(this.hidden, true),
    }
  }

  /** Whether the walk should go on into this node's children. False for a node
   *  that was replaced wholesale: the syntax inside it is part of what the
   *  replacement stands for, and decorating it again would overlap. */
  private visit(node: SyntaxNode): boolean {
    const name = node.name

    const heading = HEADING.exec(name)
    if (heading) {
      this.markLines(node, `nib-h${heading[1]}`)
      return true
    }

    const lineClass = LINE_CLASS[name]
    if (lineClass) {
      this.markLines(node, lineClass)
      return true
    }

    switch (name) {
      case 'Blockquote':
        this.blockquote(node)
        return true
      case 'FencedCode':
        return this.fence(node)
      case 'ListItem':
        this.markLines(node, 'nib-li', true)
        return true
      case 'HeaderMark':
      case 'QuoteMark':
        // Block marks follow the caret's line, and swallow the space after them
        // so hiding `# ` does not indent the heading by one column.
        this.conceal(node.from, this.eatSpace(node.to), lineRevealed(this.state, node.from))
        return true
      case 'CodeMark':
        // Both of a fence's ``` show together whenever the caret is anywhere in
        // the block, so its extent is never in doubt while it is being edited.
        // Inline backticks follow their own span.
        this.conceal(node.from, node.to, revealed(this.state, node))
        return true
      case 'ListMark':
        this.listMark(node)
        return true
      case 'TaskMarker':
        this.taskMarker(node)
        return true
      case 'HorizontalRule':
        this.inlineWidget(node, new RuleWidget(), lineRevealed(this.state, node.from))
        return true
      case 'Image':
        return this.image(node)
      case 'HTMLTag':
      case 'HTMLBlock':
        return this.htmlImage(node)
      case 'Emoji':
        return this.emoji(node)
      case 'InlineMath':
        return this.inlineMath(node)
      case 'BlockMath':
        return this.blockMath(node)
      case 'CodeInfo':
        // Shown alongside the fences it belongs to, not on its own schedule.
        this.conceal(node.from, node.to, revealed(this.state, node))
        return true
      case 'TableDelimiter':
        this.tableDelimiter(node)
        return true
      case 'InlineCode':
        // The mono face alone is a weak signal at this size, so inline code
        // gets the same box the exported HTML gives it. Pushed before the walk
        // reaches the backticks inside, which conceal themselves as usual.
        this.marks.push(Decoration.mark({ class: 'nib-inline-code' }).range(node.from, node.to))
        return true
      case 'Link':
        this.link(node)
        return true
      case 'URL':
        if (concealable(node)) this.conceal(node.from, node.to, revealed(this.state, node))
        // A bare address, or one between the `<` `>` of an autolink: shown as
        // itself, and it is the link.
        else this.linkText(node.from, node.to, this.state.doc.sliceString(node.from, node.to))
        return true
      case 'Subscript':
        this.marks.push(Decoration.mark({ class: 'nib-sub' }).range(node.from, node.to))
        return true
      case 'Superscript':
        this.marks.push(Decoration.mark({ class: 'nib-sup' }).range(node.from, node.to))
        return true
      default:
        if (concealable(node)) this.conceal(node.from, node.to, revealed(this.state, node))
        return true
    }
  }

  /** The label of `[label](target)` reads as a link: coloured, underlined, and
   *  the target in its tooltip, which a modifier-click follows (see links.ts).
   *  The marks around it conceal themselves as usual on the walk below. */
  private link(node: SyntaxNode) {
    const open = node.firstChild
    const close = open?.nextSibling
    if (!open || !close || open.name !== 'LinkMark' || close.name !== 'LinkMark') return

    const url = node.getChild('URL')
    const target = url ? this.state.doc.sliceString(url.from, url.to) : ''
    this.linkText(open.to, close.from, target)
  }

  private linkText(from: number, to: number, target: string) {
    if (from >= to) return
    // A target the browser cannot follow - a relative path, a `#heading` -
    // still reads as a link, but carries no `data-href` for links.ts to open.
    const href = hrefOf(target)
    const spec = href
      ? { class: 'nib-link', attributes: { 'data-href': href, title: linkTitle(href) } }
      : { class: 'nib-link' }
    this.marks.push(Decoration.mark(spec).range(from, to))
  }

  private isClaimed(from: number, to: number): boolean {
    return this.claimed.some((range) => from >= range.from && to <= range.to)
  }

  /** Hidden when inactive; tagged `.md-meta` when shown so it bleeds back in. */
  private conceal(from: number, to: number, show: boolean) {
    if (from >= to || this.isClaimed(from, to)) return
    if (show) this.marks.push(meta.range(from, to))
    else this.hidden.push(hide.range(from, to))
  }

  private inlineWidget(node: SyntaxNode, widget: WidgetType, show: boolean) {
    if (show || node.from >= node.to || this.isClaimed(node.from, node.to)) return
    this.hidden.push(Decoration.replace({ widget }).range(node.from, node.to))
  }

  private blockquote(node: SyntaxNode) {
    this.markLines(node, 'nib-quote')

    const first = this.state.doc.lineAt(node.from)
    const kind = CALLOUT.exec(first.text)?.[1]?.toLowerCase()
    if (kind === undefined) return

    // Every line needs the kind, not just the header, so the accent runs the
    // full height of the callout.
    this.markLines(node, `nib-callout nib-callout-${kind}`)

    const opened = first.text.indexOf('[!')
    const from = first.from + opened
    const to = first.from + first.text.indexOf(']', opened) + 1

    // `[!NOTE]` also parses as a link label, so claim it before the walk reaches
    // the LinkMarks inside it.
    this.claimed.push({ from, to })

    if (lineRevealed(this.state, first.from)) this.marks.push(meta.range(from, to))
    else this.hidden.push(Decoration.replace({ widget: new CalloutWidget(kind) }).range(from, to))
  }

  private fence(node: SyntaxNode): boolean {
    const language = fenceLanguage(this.state, node)

    // Rendered diagrams are block replacements, which only a state field may
    // provide - see blocks.ts. Skip the subtree so nothing double-decorates it.
    if (DIAGRAM_LANGUAGES.has(language) && !overlaps(this.state, node.from, node.to)) return false

    this.markLines(node, 'nib-code')
    const doc = this.state.doc
    const open = doc.lineAt(node.from)
    this.addLineClass(open.from, 'nib-code-open')
    this.addLineClass(doc.lineAt(node.to).from, 'nib-code-close')

    // The opening line reads as empty once its fence is hidden, which leaves
    // room for the language and a copy button.
    const info = node.getChild('CodeInfo')
    const mark = node.firstChild
    const infoFrom = info ? info.from : (mark?.to ?? open.to)

    this.marks.push(
      Decoration.widget({
        widget: new FenceHeaderWidget(
          language,
          fenceCode(this.state, node),
          infoFrom,
          info ? info.to : infoFrom,
          open.from,
          doc.lineAt(node.to).to,
        ),
        side: 1,
      }).range(open.to),
    )
    return true
  }

  /** Its own range and not its parent's, unlike a syntax mark: `revealed` looks
   *  at the parent because a mark's construct is what owns it, and maths *is* a
   *  construct - so asking about its parent asked about the whole paragraph, and
   *  a caret anywhere in a paragraph turned every equation in it back to source. */
  private inlineMath(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) return true

    const tex = this.state.doc.sliceString(node.from + 1, node.to - 1)
    this.inlineWidget(node, new MathWidget(tex, false), false)
    return false
  }

  private blockMath(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) {
      this.markLines(node, 'nib-math-source')
      return true
    }
    // Rendered by the block state field; see blocks.ts.
    return false
  }

  private listMark(node: SyntaxNode) {
    // A task item renders a checkbox instead, and hides this mark with it.
    if (node.parent?.getChild('Task')) return

    const ordered = /\d/.test(this.state.doc.sliceString(node.from, node.to))
    if (ordered) {
      this.marks.push(Decoration.mark({ class: 'nib-ordered-mark' }).range(node.from, node.to))
      return
    }

    this.inlineWidget(node, new BulletWidget(this.depth(node)), false)
  }

  private taskMarker(node: SyntaxNode) {
    const checked = /x/i.test(this.state.doc.sliceString(node.from, node.to))

    const listMark = node.parent?.parent?.getChild('ListMark')
    if (listMark) this.conceal(listMark.from, this.eatSpace(listMark.to), false)

    this.hidden.push(
      Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }).range(
        node.from,
        node.to,
      ),
    )

    if (checked) this.addLineClass(this.state.doc.lineAt(node.from).from, 'nib-task-done')
  }

  /** A picture stays a picture while the caret is beside it, or selects it;
   *  only a caret inside the markup shows the markup. image.ts has the rest. */
  private image(node: SyntaxNode): boolean {
    if (imageRevealed(this.state, node.from, node.to)) return true

    const image = imageOfNode(this.state, node)
    if (!image) return true

    this.inlineWidget(node, new ImageWidget(image), false)
    // Its marks live inside the replacement now; decorating them would overlap.
    return false
  }

  /** `<u>text</u>` is how markdown underlines, and Ctrl+U writes it. The
   *  pair reads as the underline it means: tags hidden until the caret is
   *  between them, the text between drawn underlined. The parser hands out
   *  each tag on its own, so the closer is looked for among the siblings,
   *  minding nested pairs, and claimed so its own visit leaves it alone. */
  private underline(node: SyntaxNode): boolean {
    if (!/^<u\s*>$/i.test(this.state.doc.sliceString(node.from, node.to))) return false

    let depth = 0
    for (let next = node.nextSibling; next; next = next.nextSibling) {
      if (next.name !== 'HTMLTag') continue
      const tag = this.state.doc.sliceString(next.from, next.to)
      if (/^<u\s*>$/i.test(tag)) depth++
      if (!/^<\/u\s*>$/i.test(tag)) continue
      if (depth > 0) {
        depth--
        continue
      }

      const shown = overlaps(this.state, node.from, next.to)
      this.conceal(node.from, node.to, shown)
      this.conceal(next.from, next.to, shown)
      // Claimed after its own concealment, which the claim would otherwise skip.
      this.claimed.push({ from: next.from, to: next.to })
      if (node.to < next.from) {
        this.marks.push(Decoration.mark({ class: 'nib-underline' }).range(node.to, next.from))
      }
      return true
    }
    return false
  }

  /** Two pieces of HTML get rendered rather than shown: a resized image, which
   *  is how a size is recorded, and a page break, which has no markdown form. */
  private htmlImage(node: SyntaxNode): boolean {
    // A closing tag already paired up by its opener.
    if (this.isClaimed(node.from, node.to)) return true
    if (node.name === 'HTMLTag' && this.underline(node)) return true

    const tag = this.state.doc.sliceString(node.from, node.to)

    if (/page-break-(after|before)\s*:\s*always/i.test(tag)) {
      // Its own range, not its parent's: a block-level tag's parent is the
      // whole document, which the caret always overlaps.
      if (overlaps(this.state, node.from, node.to)) return true
      this.inlineWidget(node, new PageBreakWidget(), false)
      return false
    }

    return this.image(node)
  }

  /** Its own range, for the same reason as `inlineMath` above. */
  private emoji(node: SyntaxNode): boolean {
    if (overlaps(this.state, node.from, node.to)) return true

    const shortcode = this.state.doc.sliceString(node.from + 1, node.to - 1)
    const character = emojiFor(shortcode)
    if (!character) return true

    this.inlineWidget(node, new EmojiWidget(character), false)
    return false
  }

  /** Only reached while the caret is in the table's source; blocks.ts renders
   *  the real table otherwise. Dimming the pipes keeps the source readable. */
  private tableDelimiter(node: SyntaxNode) {
    this.marks.push(Decoration.mark({ class: 'nib-table-pipe' }).range(node.from, node.to))
  }

  private eatSpace(pos: number): number {
    const doc = this.state.doc
    const line = doc.lineAt(pos)
    let end = pos
    while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++
    return end
  }

  private depth(node: SyntaxNode): number {
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.name === 'BulletList') depth++
    }
    return Math.max(depth - 1, 0)
  }

  private addLineClass(pos: number, className: string) {
    const classes = this.lineClasses.get(pos) ?? new Set<string>()
    classes.add(className)
    this.lineClasses.set(pos, classes)
  }

  /** `firstOnly` keeps a nested list item from restyling its children's lines. */
  private markLines(node: SyntaxNode, className: string, firstOnly = false) {
    const doc = this.state.doc
    const last = firstOnly ? node.from : Math.min(node.to, doc.length)

    for (let pos = node.from; pos <= last;) {
      const line = doc.lineAt(pos)
      this.addLineClass(line.from, className)
      if (line.to >= doc.length) break
      pos = line.to + 1
    }
  }
}

/** Exposed for tests: builds the same decorations a view would, without a DOM. */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
) {
  return new Decorator(state).build(ranges)
}

export const livePreviewDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomic: DecorationSet

    constructor(view: EditorView) {
      const built = buildDecorations(view.state, view.visibleRanges)
      this.decorations = built.decorations
      this.atomic = built.atomic
    }

    update(update: ViewUpdate) {
      const held = update.state.field(dragging, false)
      const released = update.startState.field(dragging, false) && !held

      // Selection decides what is revealed, so it rebuilds as often as edits do
      // - except mid-drag, when reflowing the line would move the text out from
      // under the pointer.
      const settled = update.selectionSet && !held
      // A note just opened is parsed a little at a time, and the rest of the
      // tree arrives in updates of its own. Without this the part that was
      // not parsed yet stays raw until something else - a click - rebuilds.
      const reparsed = syntaxTree(update.state) !== syntaxTree(update.startState)
      // Reading mode holds every reveal shut, and it comes on in a transaction
      // that moves neither the document nor the caret - so it has to say so
      // itself, or the syntax around the caret would stay showing.
      // Numbering is here as well as in blocks.ts: an inline `\eqref` resolves to
      // the number a display equation was given, so turning the numbers off has
      // to redraw the references too.
      const sealed =
        update.startState.facet(noReveal) !== update.state.facet(noReveal) ||
        update.startState.facet(numberEquations) !== update.state.facet(numberEquations)
      if (
        update.docChanged ||
        update.viewportChanged ||
        settled ||
        released ||
        reparsed ||
        sealed
      ) {
        const built = buildDecorations(update.view.state, update.view.visibleRanges)
        this.decorations = built.decorations
        this.atomic = built.atomic
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  },
)
