import { NibWidget } from './widget'
import { EditorView } from '@codemirror/view'
// Aliased: `label` is already a local variable in more than one widget here.
import { label as uiLabel } from '../labels'

export class BulletWidget extends NibWidget {
  constructor(private readonly depth: number) {
    super()
  }

  eq(other: BulletWidget) {
    return other.depth === this.depth
  }

  toDOM() {
    const dot = document.createElement('span')
    dot.className = 'nib-bullet'
    dot.dataset.depth = String(Math.min(this.depth, 2))
    return dot
  }
}

export class CheckboxWidget extends NibWidget {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'nib-checkbox'
    box.checked = this.checked

    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
    })

    return box
  }

  ignoreEvent() {
    return false
  }
}

export class RuleWidget extends NibWidget {
  eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-rule'
    return rule
  }
}

/** GitHub-style alert headers. The kind is the one word worth showing. */
export class CalloutWidget extends NibWidget {
  constructor(private readonly kind: string) {
    super()
  }

  eq(other: CalloutWidget) {
    return other.kind === this.kind
  }

  toDOM() {
    const label = document.createElement('span')
    label.className = 'nib-callout-label'
    label.dataset.kind = this.kind
    label.textContent = this.kind.charAt(0).toUpperCase() + this.kind.slice(1)
    return label
  }
}

/** Sits on a code fence's top line: what language it is, and a way to take it. */
/** What each header registered on the editor, to take down with the header.
 *  Keyed by the element, since one widget can be drawn more than once. */
const LISTENERS = new WeakMap<HTMLElement, () => void>()

export class FenceHeaderWidget extends NibWidget {
  constructor(
    private readonly language: string,
    private readonly code: string,
    /** Where the language name lives in the document, so it can be retyped. */
    private readonly infoFrom: number,
    private readonly infoTo: number,
  ) {
    super()
  }

  eq(other: FenceHeaderWidget) {
    return (
      other.language === this.language &&
      other.code === this.code &&
      other.infoFrom === this.infoFrom
    )
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('span')
    bar.className = 'nib-fence-header'
    bar.contentEditable = 'false'

    // The widget itself takes no width: it only holds the row open. What is
    // seen sits in a box pinned to the line's right edge, so the fence text,
    // when the caret reveals it, and the controls share one row rather than
    // the controls wrapping onto a row of their own - which made the block
    // grow whenever the caret was inside it.
    const controls = document.createElement('span')
    controls.className = 'nib-fence-controls'
    bar.append(controls)

    const label = document.createElement('button')
    label.className = 'nib-fence-language'
    label.type = 'button'
    label.title = uiLabel('setLanguage')
    label.textContent = this.language || 'plain'
    if (!this.language) label.classList.add('nib-fence-unset')

    label.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.editLanguage(view, label)
    })

    controls.append(label)

    const copy = document.createElement('button')
    copy.className = 'nib-fence-copy'
    copy.type = 'button'
    copy.title = uiLabel('copy')
    copy.setAttribute('aria-label', uiLabel('copyCode'))

    // Two overlapping sheets for copy, a tick once it has been taken. Drawn
    // rather than written, so the button stays the same size in any language.
    const draw = (paths: string[]) => {
      copy.replaceChildren()
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 14 14')

      for (const d of paths) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        shape.setAttribute('d', d)
        svg.append(shape)
      }

      copy.append(svg)
    }

    const SHEETS = ['M5 5h7v7H5z', 'M2 9V2h7']
    const TICK = ['M2.5 7.5l3 3 6-6']

    draw(SHEETS)

    copy.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()

      void navigator.clipboard.writeText(this.code).then(() => {
        copy.classList.add('nib-fence-copied')
        copy.title = uiLabel('copied')
        draw(TICK)

        window.setTimeout(() => {
          copy.classList.remove('nib-fence-copied')
          copy.title = uiLabel('copy')
          draw(SHEETS)
        }, 1400)
      })
    })

    controls.append(copy)

    // The button shows while the pointer is anywhere over the block. The block
    // is a run of sibling lines rather than one element, so no CSS selector
    // can see that; the content element is watched instead, and a hovered
    // line counts when it sits between this header's line and the closing
    // line of the same block.
    const over = (event: Event) => {
      const line = (event.target as Element | null)?.closest?.('.cm-line') ?? null
      bar.classList.toggle('nib-fence-hover', !!line && FenceHeaderWidget.holds(bar, line))
    }
    const leave = () => bar.classList.remove('nib-fence-hover')

    view.contentDOM.addEventListener('mouseover', over)
    view.contentDOM.addEventListener('mouseleave', leave)
    LISTENERS.set(bar, () => {
      view.contentDOM.removeEventListener('mouseover', over)
      view.contentDOM.removeEventListener('mouseleave', leave)
    })

    return bar
  }

  destroy(dom: HTMLElement) {
    LISTENERS.get(dom)?.()
    LISTENERS.delete(dom)
    super.destroy(dom)
  }

  /** Whether `line` is one of the lines of the block this header sits on. */
  private static holds(bar: Element, line: Element): boolean {
    let current: Element | null = bar.closest('.cm-line')

    while (current?.classList.contains('nib-code')) {
      if (current === line) return true
      if (current.classList.contains('nib-code-close')) break
      current = current.nextElementSibling
    }

    return false
  }

  /** Turns the label into a field, and writes the name straight into the fence. */
  private editLanguage(view: EditorView, label: HTMLElement) {
    const field = document.createElement('input')
    field.className = 'nib-fence-language-input'
    field.value = this.language
    field.placeholder = 'language'
    field.spellcheck = false

    const commit = () => {
      const next = field.value.trim().replace(/\s+/g, '')
      field.replaceWith(label)

      if (next === this.language) return
      view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: next } })
    }

    field.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') field.blur()
      if (event.key === 'Escape') {
        field.value = this.language
        field.blur()
      }
    })
    field.addEventListener('blur', commit)

    label.replaceWith(field)
    field.focus()
    field.select()
  }

  ignoreEvent() {
    return true
  }
}

/** Where a printed page ends. Invisible in the file, obvious on screen. */
export class PageBreakWidget extends NibWidget {
  eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-page-break'
    rule.dataset.label = 'page break'
    return rule
  }
}

/** Shows `:smile:` as the character it names. */
export class EmojiWidget extends NibWidget {
  constructor(private readonly character: string) {
    super()
  }

  eq(other: EmojiWidget) {
    return other.character === this.character
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'nib-emoji'
    span.textContent = this.character
    return span
  }
}

// Images live in image.ts: they carry enough behaviour to be a file of their own.
