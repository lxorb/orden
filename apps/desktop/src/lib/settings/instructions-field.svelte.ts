export const SETTLES_AFTER = 900

export const GIVES_UP_AFTER = 10_000

export interface FieldHands {
  space(path: string): Promise<boolean>
  read(path: string): Promise<string | null>
  there(path: string): Promise<boolean>
  write(path: string, before: string, after: string, first: boolean): Promise<void>
  make(path: string, text: string): Promise<void>
}

function inField(words: string): string {
  return words.replace(/\r\n?/g, '\n')
}

async function merged(base: string, mine: string, theirs: string): Promise<string> {
  const { merge3 } = await import('@orden/sync-core/merge3')
  return merge3(base, mine, theirs).text
}

export class InstructionsField {
  text = $state('')
  loaded = $state(false)
  unreadable = $state(false)
  dirty = $state(false)
  orphaned = $state(false)

  private base = ''
  private wrote = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly hands: FieldHands,
    private readonly reading: () => boolean = () => false,
  ) {}

  get locked(): boolean {
    return this.unreadable || this.orphaned || this.reading()
  }

  async load() {
    const words = await this.hands.read(this.path)
    if (words === null && (await this.hands.there(this.path))) this.unreadable = true
    if (!this.dirty) {
      this.text = inField(words ?? '')
      this.base = this.text
    }
    this.loaded = true
  }

  async look() {
    if (this.dirty) return
    const words = await this.hands.read(this.path)
    if (words !== null) this.heard(words)
  }

  type(words: string) {
    if (this.locked || !this.loaded) return
    this.text = words
    this.dirty = words !== this.base
    clearTimeout(this.timer)
    if (this.dirty) this.timer = setTimeout(() => void this.flush(), SETTLES_AFTER)
  }

  heard(words: string) {
    if (this.dirty) return
    this.text = inField(words)
    this.base = this.text
    this.unreadable = false
  }

  flush(): Promise<void> {
    clearTimeout(this.timer)
    this.writing = this.writing.then(() => this.bounded())
    return this.writing
  }

  private async bounded() {
    let timer: ReturnType<typeof setTimeout> | undefined
    const gives = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, GIVES_UP_AFTER)
    })
    await Promise.race([this.write(), gives])
    clearTimeout(timer)
  }

  private async write() {
    if (!this.dirty || this.locked) return

    const after = this.text
    try {
      const before = await this.hands.read(this.path)
      if (before === null) {
        if (await this.hands.there(this.path)) {
          this.unreadable = true
          return
        }
        if (!(await this.hands.space(this.path))) {
          this.orphaned = true
          return
        }
        if (after) await this.hands.make(this.path, after)
        this.settled(after, after)
        return
      }

      const held = inField(before)
      const crossed = held !== this.base
      const words = crossed ? await merged(this.base, after, held) : after
      if (words !== held) {
        await this.hands.write(this.path, before, words, crossed || !this.wrote)
        this.wrote = true
      }
      this.settled(after, words)
    } catch {
      // Still owed, and still in the field; leaving it or the next pause tries again.
    }
  }

  private settled(typed: string, words: string) {
    this.base = words
    if (this.text === typed) {
      this.text = words
      this.dirty = false
    } else {
      this.dirty = this.text !== words
    }
  }
}
