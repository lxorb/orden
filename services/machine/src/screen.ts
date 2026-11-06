import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import headless from '@xterm/headless'
import { SCROLLBACK } from '@orden/online/wire'

const { Terminal } = headless

export class Screen {
  readonly term: InstanceType<typeof Terminal>
  private readonly serializer = new SerializeAddon()
  title: string | null = null

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.loadAddon(this.serializer)
    this.term.onTitleChange((title) => {
      this.title = title || null
    })
  }

  get cols(): number {
    return this.term.cols
  }

  get rows(): number {
    return this.term.rows
  }

  write(data: Uint8Array | string): void {
    this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  serialized(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        resolve(evenColours(this.serializer.serialize({ scrollback: SCROLLBACK })))
      })
    })
  }

  saved(): Promise<string> {
    return new Promise((resolve) => {
      this.term.write('', () => {
        resolve(
          this.serializer.serialize({
            scrollback: SCROLLBACK,
            excludeModes: true,
            excludeAltBuffer: true,
          }),
        )
      })
    })
  }

  dispose(): void {
    this.term.dispose()
  }

  static async firstOf(whole: string, cols: number, rows: number): Promise<string> {
    const scratch = new Screen(cols, rows)
    scratch.write(whole)
    const first = await scratch.saved()
    scratch.dispose()
    return first
  }
}

const TO_SECOND = '\x1b[?1049h\x1b[H'

function evenColours(serialized: string): string {
  const at = serialized.indexOf(TO_SECOND)
  return at < 0 ? serialized : `${serialized.slice(0, at)}\x1b[0m${serialized.slice(at)}`
}
