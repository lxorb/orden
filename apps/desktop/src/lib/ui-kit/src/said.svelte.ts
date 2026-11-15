const HELD = 4000

class Said {
  words = $state('')

  private clearing: ReturnType<typeof setTimeout> | undefined

  private showing = ''

  private turn = 0

  say(words: string): void {
    const asked = words.trim()
    if (!asked) return

    clearTimeout(this.clearing)
    const mine = ++this.turn

    if (asked === this.showing) {
      this.write('')
      queueMicrotask(() => {
        if (mine === this.turn) this.write(asked)
      })
    } else {
      this.write(asked)
    }

    this.clearing = setTimeout(() => {
      if (mine === this.turn) this.write('')
    }, HELD)
  }

  private write(words: string): void {
    this.showing = words
    this.words = words
  }
}

export const said = new Said()

export function told(words: string): () => void {
  return () => said.say(words)
}
