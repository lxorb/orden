import { calloutIconParts } from '@orden/markdown/callouts'
import { NibWidget } from './widget'
import { EditorView } from '@codemirror/view'
import { iconElement } from '../icon'
import { fenceCodeAt } from '../fence'
import { label as uiLabel } from '../labels'
import { pressedByKey } from '../press'
import { isRunnableLanguage, runFence, runnableFenceAt } from '../run/door'
import { isAiLanguage } from '../ai/block'
import { aiFenceAt, askAiFence, stopAskAt } from '../ai/run'
import { noteIndex } from '../wikilink/notes'

export class BulletWidget extends NibWidget {
  constructor(private readonly depth: number) {
    super()
  }

  override eq(other: BulletWidget) {
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

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from
  }

  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'nib-checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', uiLabel('taskDone'))

    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      if (view.state.readOnly) return
      const help = view.state.facet(noteIndex).tasks
      if (help) {
        const { doc } = view.state
        const line = doc.lineAt(this.from).number
        void import('../task-tick').then(({ tickLines }) => tickLines(view, help, doc, [line]))
        return
      }
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
    })

    return box
  }

  override ignoreEvent() {
    return false
  }
}

export class RuleWidget extends NibWidget {
  override eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-rule'
    return rule
  }
}

function calloutIcon(look: string | null): SVGElement | null {
  const parts = calloutIconParts(look)
  return parts ? iconElement(parts, 'callout-icon') : null
}

export class CalloutWidget extends NibWidget {
  constructor(
    private readonly type: string,
    private readonly look: string | null,
    private readonly name: string,
  ) {
    super()
  }

  override eq(other: CalloutWidget) {
    return other.type === this.type && other.look === this.look && other.name === this.name
  }

  toDOM() {
    const label = document.createElement('span')
    label.className = 'nib-callout-label'
    label.dataset.callout = this.type

    const icon = calloutIcon(this.look)
    if (icon) label.append(icon)

    if (this.name) {
      const word = document.createElement('span')
      word.textContent = this.name
      label.append(word)
    }

    return label
  }
}

export class FenceHeaderWidget extends NibWidget {
  constructor(
    private readonly language: string,
    private readonly caption: string,
    private readonly infoFrom: number,
    private readonly infoTo: number,
    private readonly blockFrom: number,
    private readonly asking = false,
  ) {
    super()
  }

  override eq(other: FenceHeaderWidget) {
    return (
      other.language === this.language &&
      other.caption === this.caption &&
      other.infoFrom === this.infoFrom &&
      other.blockFrom === this.blockFrom &&
      other.asking === this.asking
    )
  }

  toDOM(view: EditorView) {
    const bar = document.createElement('span')
    bar.className = 'nib-fence-header'
    bar.contentEditable = 'false'

    const row = document.createElement('span')
    row.className = 'nib-fence-row'
    bar.append(row)

    if (this.caption) {
      const said = document.createElement('span')
      said.className = 'nib-fence-caption'
      said.textContent = this.caption
      row.append(said)
    }

    const controls = document.createElement('span')
    controls.className = 'nib-fence-controls'
    row.append(controls)

    const label = document.createElement('button')
    label.className = 'nib-fence-language'
    label.type = 'button'
    label.title = uiLabel('setLanguage')
    label.textContent = this.language || 'plain'
    if (!this.language) label.classList.add('nib-fence-unset')

    const edit = () => this.editLanguage(view, label)
    label.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      edit()
    })
    pressedByKey(label, edit)

    controls.append(label)

    if (isRunnableLanguage(this.language)) controls.append(this.runButton(view))
    else if (isAiLanguage(this.language)) controls.append(this.askButton(view))

    const copy = document.createElement('button')
    copy.className = 'nib-fence-copy'
    copy.type = 'button'
    copy.title = uiLabel('copy')
    copy.setAttribute('aria-label', uiLabel('copyCode'))

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

    const take = () => {
      navigator.clipboard
        .writeText(fenceCodeAt(view.state, this.blockFrom))
        .then(() => {
          copy.classList.add('nib-fence-copied')
          copy.title = uiLabel('copied')
          draw(TICK)

          window.setTimeout(() => {
            copy.classList.remove('nib-fence-copied')
            copy.title = uiLabel('copy')
            draw(SHEETS)
          }, 1400)
        })
        .catch(() => undefined)
    }

    copy.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      take()
    })
    pressedByKey(copy, take)

    controls.append(copy)

    const over = (event: Event) => {
      const target = event.target
      const line = target instanceof Element ? target.closest('.cm-line') : null
      bar.classList.toggle('nib-fence-hover', !!line && FenceHeaderWidget.holds(bar, line))
    }
    const leave = () => bar.classList.remove('nib-fence-hover')

    view.contentDOM.addEventListener('mouseover', over)
    view.contentDOM.addEventListener('mouseleave', leave)
    this.onDestroy(bar, () => {
      view.contentDOM.removeEventListener('mouseover', over)
      view.contentDOM.removeEventListener('mouseleave', leave)
    })

    return bar
  }

  private static holds(bar: Element, line: Element): boolean {
    let current: Element | null = bar.closest('.cm-line')

    while (current?.classList.contains('nib-code')) {
      if (current === line) return true
      if (current.classList.contains('nib-code-close')) break
      current = current.nextElementSibling
    }

    return false
  }

  private glyphButton(title: string, spoken: string, path: string, press: () => void): HTMLElement {
    const button = document.createElement('button')
    button.className = 'nib-fence-run'
    button.type = 'button'
    button.title = title
    button.setAttribute('aria-label', spoken)

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 14 14')
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    shape.setAttribute('d', path)
    svg.append(shape)
    button.append(svg)

    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      press()
    })
    pressedByKey(button, press)

    return button
  }

  private runButton(view: EditorView): HTMLElement {
    return this.glyphButton(uiLabel('run'), uiLabel('runCode'), 'M4 2.6l7 4.4-7 4.4z', () => {
      const fence = runnableFenceAt(view.state, this.blockFrom)
      if (fence) runFence(view, fence)
    })
  }

  private askButton(view: EditorView): HTMLElement {
    if (this.asking) {
      return this.glyphButton(uiLabel('stop'), uiLabel('stop'), 'M4 4h6v6H4z', () =>
        stopAskAt(view, this.blockFrom),
      )
    }

    return this.glyphButton(uiLabel('ask'), uiLabel('askModel'), 'M4 2.6l7 4.4-7 4.4z', () => {
      const fence = aiFenceAt(view.state, this.blockFrom)
      if (fence) askAiFence(view, fence)
    })
  }

  private editLanguage(view: EditorView, label: HTMLElement) {
    const field = document.createElement('input')
    field.className = 'nib-fence-language-input'
    field.value = this.language
    field.placeholder = uiLabel('fenceLanguage')
    field.spellcheck = false

    const written = view.state.sliceDoc(this.infoFrom, this.infoTo)
    const commit = () => {
      const next = field.value.trim().replace(/\s+/g, '')
      field.replaceWith(label)

      if (next === this.language) return
      queueMicrotask(() => {
        if (view.state.sliceDoc(this.infoFrom, this.infoTo) !== written) return
        view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: next } })
      })
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

  override ignoreEvent() {
    return true
  }
}

export class PageBreakWidget extends NibWidget {
  override eq() {
    return true
  }

  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'nib-page-break'
    rule.dataset.label = 'page break'
    return rule
  }
}

export class EmojiWidget extends NibWidget {
  constructor(private readonly character: string) {
    super()
  }

  override eq(other: EmojiWidget) {
    return other.character === this.character
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'nib-emoji'
    span.textContent = this.character
    return span
  }
}
