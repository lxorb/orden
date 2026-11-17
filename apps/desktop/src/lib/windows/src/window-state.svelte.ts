export interface Resizable {
  isMaximized(): Promise<boolean>
  isFullscreen(): Promise<boolean>
  toggleMaximize(): Promise<void>
  onResized(handler: () => void): Promise<() => void>
}

export class WindowState {
  maximized = $state(false)

  fullscreen = $state(false)

  follow(open: () => Promise<Resizable>): () => void {
    const watching = { alive: true, stop: null as (() => void) | null }

    void open().then(async (window) => {
      const read = () => void this.read(window, watching)
      const stop = await window.onResized(read)

      if (watching.alive) {
        watching.stop = stop
        read()
      } else stop()
    })

    return () => {
      watching.alive = false
      watching.stop?.()
      watching.stop = null
    }
  }

  async toggle(window: Resizable) {
    await window.toggleMaximize()
    this.maximized = await window.isMaximized()
  }

  private async read(window: Resizable, watching: { alive: boolean }) {
    const [on, full] = await Promise.all([window.isMaximized(), window.isFullscreen()])
    if (!watching.alive) return

    this.maximized = on
    this.fullscreen = full
  }
}
