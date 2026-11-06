const GROUND = 0
const ESCAPE = 1
const CSI = 2
const TEXT = 3
const TEXT_ESCAPE = 4
type State = typeof GROUND | typeof ESCAPE | typeof CSI | typeof TEXT | typeof TEXT_ESCAPE

const ESC = 0x1b
const BEL = 0x07
const CAN = 0x18
const SUB = 0x1a

export class Scanner {
  private state: State = GROUND
  private more = 0
  safe = 0
  private at = 0

  feed(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.step(byte)
      this.at += 1
      if (this.state === GROUND && this.more === 0) this.safe = this.at
    }
  }

  private step(byte: number): void {
    if (byte === CAN || byte === SUB) {
      this.state = GROUND
      this.more = 0
      return
    }
    switch (this.state) {
      case GROUND:
        if (this.more > 0 && (byte & 0xc0) === 0x80) {
          this.more -= 1
          return
        }
        this.more = 0
        if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0xf0 && byte <= 0xf7) this.more = 3
        else if (byte >= 0xe0) this.more = byte <= 0xef ? 2 : 0
        else if (byte >= 0xc2) this.more = byte <= 0xdf ? 1 : 0
        return
      case ESCAPE:
        if (byte === 0x5b) this.state = CSI
        else if (
          byte === 0x5d ||
          byte === 0x50 ||
          byte === 0x58 ||
          byte === 0x5e ||
          byte === 0x5f
        ) {
          this.state = TEXT
        } else if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0x30 && byte <= 0x7e) this.state = GROUND
        return
      case CSI:
        if (byte === ESC) this.state = ESCAPE
        else if (byte >= 0x40 && byte <= 0x7e) this.state = GROUND
        return
      case TEXT:
        if (byte === BEL) this.state = GROUND
        else if (byte === ESC) this.state = TEXT_ESCAPE
        return
      case TEXT_ESCAPE:
        if (byte === 0x5c) this.state = GROUND
        else {
          this.state = ESCAPE
          this.step(byte)
        }
        return
    }
  }
}
