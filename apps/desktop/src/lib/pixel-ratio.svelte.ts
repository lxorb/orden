function read(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

class PixelRatio {
  #now = $state(read())
  #watching = false

  get now(): number {
    this.#watch()
    return this.#now
  }

  #watch() {
    if (this.#watching || typeof matchMedia !== 'function') return
    this.#watching = true
    const listen = () => {
      const query = matchMedia(`(resolution: ${String(read())}dppx)`)
      query.addEventListener(
        'change',
        () => {
          this.#now = read()
          listen()
        },
        { once: true },
      )
    }
    listen()
  }
}

export const pixelRatio = new PixelRatio()
