import { viewport } from './viewport.svelte'

class BackStack {
  private layers: { id: number; close: () => void }[] = []
  private next = 1
  private listening = false
  private pending = 0

  open(close: () => void): () => void {
    this.listen()

    const layer = { id: this.next++, close }
    this.layers.push(layer)
    history.pushState({ ordenLayer: layer.id }, '')

    return () => {
      const at = this.layers.indexOf(layer)
      if (at < 0) return

      this.layers.splice(at, 1)

      const ours = (history.state as { ordenLayer?: number } | null)?.ordenLayer
      if (typeof ours !== 'number') return

      this.pending++
      history.back()
    }
  }

  private listen() {
    if (this.listening) return
    this.listening = true

    window.addEventListener('popstate', () => {
      if (this.pending > 0) {
        this.pending--
        return
      }

      const layer = this.layers.pop()
      layer?.close()
    })
  }
}

const backstack = new BackStack()

export function closeOnBack(open: boolean, close: () => void): (() => void) | undefined {
  if (!open || !viewport.touch) return
  return backstack.open(close)
}
