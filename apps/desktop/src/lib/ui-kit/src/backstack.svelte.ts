import { viewport } from './viewport.svelte'

interface Layer {
  id: number
  close: () => void
}

function depthOf(state: unknown): number {
  const depth = (state as { ordenDepth?: unknown } | null)?.ordenDepth
  return typeof depth === 'number' && depth > 0 ? depth : 0
}

class BackStack {
  private layers: Layer[] = []
  private next = 1
  private listening = false
  private at = 0
  private moving = false
  private queued = false

  open(close: () => void): () => void {
    this.listen()

    const layer = { id: this.next++, close }
    this.layers.push(layer)
    this.grow()

    return () => {
      const index = this.layers.indexOf(layer)
      if (index < 0) return

      this.layers.splice(index, 1)
      this.later()
    }
  }

  private grow() {
    if (this.moving) return
    while (this.at < this.layers.length) {
      this.at++
      history.pushState({ ordenLayer: this.layers[this.at - 1]?.id, ordenDepth: this.at }, '')
    }
  }

  private later() {
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      this.settle()
    })
  }

  private settle() {
    if (this.moving) return
    if (this.at > this.layers.length) {
      const steps = this.layers.length - this.at
      this.at = this.layers.length
      this.moving = true
      history.go(steps)
      return
    }
    this.grow()
  }

  private listen() {
    if (this.listening) return
    this.listening = true
    this.at = depthOf(history.state)

    window.addEventListener('popstate', (event) => {
      this.at = depthOf(event.state)
      if (this.moving) {
        this.moving = false
        this.settle()
        return
      }

      while (this.layers.length > this.at) this.layers.pop()?.close()
      this.settle()
    })
  }
}

const backstack = new BackStack()

export function closeOnBack(open: boolean, close: () => void): (() => void) | undefined {
  if (!open || !viewport.touch) return
  return backstack.open(close)
}
