export const MOVE = 170

export const SNAP = 90

export class Frame {
  moving = $state(false)
  following = $state(false)

  private settling: ReturnType<typeof setTimeout> | undefined
  private easing: ReturnType<typeof setTimeout> | undefined

  scrolled(): void {
    this.moving = false
    this.following = true
    clearTimeout(this.settling)
    clearTimeout(this.easing)

    this.settling = setTimeout(() => {
      this.following = false
      this.spring()
    }, SNAP)
  }

  turned(): void {
    clearTimeout(this.settling)
    this.following = false
    this.spring()
  }

  private spring(): void {
    this.moving = true
    clearTimeout(this.easing)
    this.easing = setTimeout(() => {
      this.moving = false
    }, MOVE)
  }

  stop(): void {
    clearTimeout(this.settling)
    clearTimeout(this.easing)
    this.moving = false
    this.following = false
  }
}
