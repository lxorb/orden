export type Field = HTMLTextAreaElement | HTMLInputElement

export function spacedIn(before: string, words: string, after: string): string {
  if (!words) return ''
  const left = before && !/\s$/.test(before) ? ' ' : ''
  const right = after && !/^[\s.,;:!?)\]}]/.test(after) ? ' ' : ''
  return `${left}${words}${right}`
}

function changed(was: string, now: string): { from: number; was: number; now: number } {
  let from = 0
  const most = Math.min(was.length, now.length)
  while (from < most && was[from] === now[from]) from++
  let end = 0
  while (end < most - from && was[was.length - 1 - end] === now[now.length - 1 - end]) end++
  return { from, was: was.length - end, now: now.length - end }
}

export class Spot {
  from: number
  to: number
  private readonly original: string
  private written: string
  private writing = false
  private readonly mark: Mark

  constructor(
    private readonly field: Field,
    private readonly broken: () => void,
  ) {
    const value = field.value
    this.from = field.selectionStart ?? value.length
    this.to = field.selectionEnd ?? this.from
    this.original = value.slice(this.from, this.to)
    this.written = value
    this.mark = new Mark(field)
    field.addEventListener('input', this.typed)
  }

  before(): string {
    return this.field.value.slice(0, this.from)
  }

  show(words: string, live: boolean): void {
    const value = this.field.value
    const before = value.slice(0, this.from)
    const after = value.slice(this.to)
    const put = spacedIn(before, words.trim(), after)
    const caret = this.field.selectionStart ?? value.length
    const end = this.to
    const shift = put.length - (end - this.from)

    this.write(before + put + after)
    this.to = this.from + put.length
    const at = caret >= this.from && caret <= end ? this.to : caret > end ? caret + shift : caret
    this.field.setSelectionRange(at, at)

    if (live && put.trim()) this.mark.show(this.field.value, this.from, this.to)
    else this.mark.hide()
  }

  restore(): void {
    this.mark.hide()
    const value = this.field.value
    this.write(value.slice(0, this.from) + this.original + value.slice(this.to))
    this.to = this.from + this.original.length
    this.field.setSelectionRange(this.to, this.to)
  }

  release(): void {
    this.mark.hide()
    this.field.removeEventListener('input', this.typed)
  }

  private write(value: string): void {
    if (value === this.field.value) return
    this.writing = true
    this.field.value = value
    this.written = value
    this.field.dispatchEvent(new Event('input', { bubbles: true }))
    this.writing = false
  }

  private readonly typed = () => {
    if (this.writing) return
    const now = this.field.value
    const edit = changed(this.written, now)
    this.written = now
    if (edit.was <= this.from && edit.from <= this.from) {
      const shift = edit.now - edit.was
      this.from += shift
      this.to += shift
    } else if (edit.from < this.to || edit.was < this.to) {
      this.mark.hide()
      this.broken()
    }
    if (this.mark.shown) this.mark.show(now, this.from, this.to)
  }
}

class Mark {
  private layer: HTMLDivElement | null = null
  shown = false

  constructor(private readonly field: Field) {}

  show(value: string, from: number, to: number): void {
    const layer = this.layer ?? this.made()
    if (!layer) return
    this.shown = true
    this.place(layer)
    const words = document.createElement('mark')
    words.textContent = value.slice(from, to)
    words.style.cssText =
      'color:transparent;background:var(--accent-soft);border-radius:2px;' +
      'text-decoration:underline dotted var(--accent);text-underline-offset:3px'
    layer.replaceChildren(value.slice(0, from), words, value.slice(to) || '​')
    layer.scrollTop = this.field.scrollTop
    layer.scrollLeft = this.field.scrollLeft
  }

  hide(): void {
    this.shown = false
    this.layer?.remove()
    this.layer = null
    this.field.removeEventListener('scroll', this.scrolled)
  }

  private made(): HTMLDivElement | null {
    const parent = this.field.offsetParent
    if (!(parent instanceof HTMLElement)) return null
    const layer = document.createElement('div')
    layer.setAttribute('aria-hidden', 'true')
    layer.dataset.heard = ''
    parent.append(layer)
    this.field.addEventListener('scroll', this.scrolled)
    this.layer = layer
    return layer
  }

  private place(layer: HTMLDivElement): void {
    const field = this.field
    const style = getComputedStyle(field)
    const area = field instanceof HTMLTextAreaElement
    const copied = [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'word-spacing',
      'line-height',
      'text-transform',
      'text-indent',
      'tab-size',
      'direction',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
    ]
      .map((name) => `${name}:${style.getPropertyValue(name)}`)
      .join(';')
    layer.style.cssText =
      `${copied};position:absolute;left:${field.offsetLeft}px;top:${field.offsetTop}px;` +
      `width:${field.offsetWidth}px;height:${field.offsetHeight}px;box-sizing:border-box;` +
      'border-style:solid;border-color:transparent;color:transparent;overflow:hidden;' +
      'pointer-events:none;margin:0;z-index:1;' +
      (area ? 'white-space:pre-wrap;overflow-wrap:break-word;' : 'white-space:pre;')
  }

  private readonly scrolled = () => {
    if (!this.layer) return
    this.layer.scrollTop = this.field.scrollTop
    this.layer.scrollLeft = this.field.scrollLeft
  }
}
