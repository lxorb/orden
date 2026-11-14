import type { InputEvent, PointerShape } from '@orden/online/apps'

function drawn(box: DOMRectReadOnly, width: number, height: number) {
  const scale = Math.min(box.width / width, box.height / height)
  return {
    left: box.left + (box.width - width * scale) / 2,
    top: box.top + (box.height - height * scale) / 2,
    scale,
  }
}

export function displayPoint(
  clientX: number,
  clientY: number,
  box: DOMRectReadOnly,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return null
  const { left, top, scale } = drawn(box, width, height)
  const clamp = (value: number, most: number) => Math.min(Math.max(value, 0), most - 1)
  return {
    x: Math.round(clamp((clientX - left) / scale, width)),
    y: Math.round(clamp((clientY - top) / scale, height)),
  }
}

const PIXELS_A_CLICK = 100
const LINES_A_CLICK = 3

export function wheelClicks(
  left: { x: number; y: number },
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): { x: number; y: number; left: { x: number; y: number } } {
  const per = deltaMode === 0 ? PIXELS_A_CLICK : deltaMode === 1 ? LINES_A_CLICK : 1
  const x = left.x + deltaX / per
  const y = left.y + deltaY / per
  const whole = (value: number) => Math.trunc(value) || 0
  return { x: whole(x), y: whole(y), left: { x: x - whole(x), y: y - whole(y) } }
}

export function keyEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'isComposing'>,
  down: boolean,
): InputEvent | null {
  const unsent =
    event.isComposing ||
    event.key === 'Dead' ||
    event.key === 'Process' ||
    event.key === 'Unidentified'
  if (down && unsent) return null
  return { t: 'key', key: event.key, code: event.code, down }
}

export function isPaste(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): boolean {
  const v = event.key === 'v' || event.key === 'V'
  return ((event.ctrlKey || event.metaKey) && v) || (event.shiftKey && event.key === 'Insert')
}

export function textEvent(text: string | null | undefined): InputEvent | null {
  return text ? { t: 'text', text } : null
}

export function drivesPointer(event: Pick<PointerEvent, 'isPrimary'>): boolean {
  return event.isPrimary
}

export class HeldKeys {
  private readonly held = new Set<string>()
  private readonly pressed = new Set<number>()

  saw(event: InputEvent): void {
    if (event.t === 'button') {
      if (event.down) this.pressed.add(event.button)
      else this.pressed.delete(event.button)
    }
    if (event.t !== 'key') return
    if (event.down) this.held.add(event.code)
    else this.held.delete(event.code)
  }

  letGo(): InputEvent[] {
    const all = [...this.held].map((code): InputEvent => ({ t: 'key', key: '', code, down: false }))
    this.held.clear()
    return all
  }

  letGoButtons(): InputEvent[] {
    const all = [...this.pressed].map((button): InputEvent => ({
      t: 'button',
      button,
      down: false,
    }))
    this.pressed.clear()
    return all
  }
}

export function pointerStyle(pointer: PointerShape | null, dpr: number): string {
  if (!pointer) return ''
  if ('hidden' in pointer) return 'none'
  const ratio = dpr > 0 ? dpr : 1
  const x = Math.round(pointer.x / ratio)
  const y = Math.round(pointer.y / ratio)
  return `-webkit-image-set(url("${pointer.png}") ${ratio}x) ${x} ${y}, default`
}
