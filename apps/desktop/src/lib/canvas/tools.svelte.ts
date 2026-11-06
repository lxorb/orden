import { type InkTool } from './format'
import { nibFor, pens } from './pens.svelte'
import { DEFAULT_INK } from './palette'
import { type Tool } from './pointer'

export const HOLD = 250

const SPRUNG: ReadonlySet<Tool> = new Set<Tool>(['lasso'])

interface Held {
  code: string
  repeat?: boolean
  timeStamp: number
}

class Tools {
  which = $state<Tool>('select')

  colour = $state<string>(DEFAULT_INK)

  get ink(): { tool: InkTool; size: number; color: string; opacity: number } {
    const nib = pens.current
    return { tool: nib.tool, size: nib.size, color: nib.colour, opacity: nib.opacity }
  }

  choose(tool: Tool) {
    this.which = tool
  }

  private spring: { code: string; was: Tool; at: number; used: boolean } | null = null

  pressed(tool: Tool, key: Held) {
    if (key.repeat) return
    this.spring =
      SPRUNG.has(tool) && this.which !== tool
        ? { code: key.code, was: this.which, at: key.timeStamp, used: false }
        : null
    this.choose(tool)
  }

  used() {
    if (this.spring) this.spring.used = true
  }

  released(key: Held) {
    const spring = this.spring
    if (spring?.code !== key.code) return

    this.spring = null
    if (!SPRUNG.has(this.which)) return
    if (spring.used || key.timeStamp - spring.at >= HOLD) this.which = spring.was
  }

  choosePen(tool: InkTool) {
    pens.set(nibFor(tool, pens.current.colour))
    this.drawing()
  }

  pickPen(index: number) {
    pens.pick(index)
    this.drawing()
  }

  done() {
    if (!drawn(this.which)) this.which = 'select'
  }

  private drawing() {
    this.which = 'draw'
  }
}

function drawn(tool: Tool): boolean {
  return tool === 'draw' || tool === 'erase' || tool === 'lasso' || tool === 'hand'
}

export const tools = new Tools()
