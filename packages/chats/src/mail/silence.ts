export class Silence {
  private heardAt = Date.now()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(longest: number, waiting: () => boolean, gone: () => void) {
    this.timer = setInterval(
      () => {
        if (!waiting() || Date.now() - this.heardAt < longest) return
        this.stop()
        gone()
      },
      Math.min(longest, 15_000),
    )
  }

  heard(): void {
    this.heardAt = Date.now()
  }

  stop(): void {
    clearInterval(this.timer)
  }
}
