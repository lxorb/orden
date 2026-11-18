import { copyText } from './clipboard'

export const SAID_FOR = 1600

export class Copied<T = true> {
  what = $state<T | null>(null)
  private saying: ReturnType<typeof setTimeout> | undefined

  async copy(text: string, what: T): Promise<void> {
    await copyText(text)
    this.what = what
    clearTimeout(this.saying)
    this.saying = setTimeout(() => (this.what = null), SAID_FOR)
  }

  stop(): void {
    clearTimeout(this.saying)
  }
}
