export interface Ticked {
  at: string
  back: () => Promise<boolean>
}

export type TickAt = (at: string, done: boolean) => Promise<Ticked | null>

export class TaskTurns {
  private undo: { from: string; back: () => Promise<boolean> } | null = null
  private last: Promise<unknown> = Promise.resolve()

  constructor(
    private at: string,
    private readonly tick: TickAt,
  ) {}

  turn(done: boolean): Promise<boolean> {
    const turned = this.last.then(() => this.turned(done).catch(() => false))
    this.last = turned
    return turned
  }

  private async turned(done: boolean): Promise<boolean> {
    const undo = this.undo
    this.undo = null
    if (!done && undo && (await undo.back())) {
      this.at = undo.from
      return true
    }
    const from = this.at
    const ticked = await this.tick(from, done)
    if (!ticked) return false
    this.at = ticked.at
    if (done) this.undo = { from, back: ticked.back }
    return true
  }
}
