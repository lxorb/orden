export interface Traced {
  what: string
  kind: string
  button: number
  buttons: number
  id: number
}

const KEPT = 8

export class Trace {
  private held: Traced[] = []
  private was = new Map<number, number>()

  note(one: Traced): boolean {
    if (one.what === 'move') {
      if (this.was.get(one.id) === one.buttons) return false
      this.was.set(one.id, one.buttons)
    } else if (one.what === 'down') {
      this.was.set(one.id, one.buttons)
    } else {
      this.was.delete(one.id)
    }

    this.held.push(one)
    if (this.held.length > KEPT) this.held.shift()
    return true
  }

  get line(): string {
    return this.held
      .map((one) => `${one.what}/${one.kind} b${one.button} B${one.buttons}`)
      .join(' | ')
  }
}
