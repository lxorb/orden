export class Latest<T> {
  private flying: Promise<void> | null = null
  private waiting: { one: T; landed: Promise<void> } | null = null

  constructor(private readonly send: (one: T) => Promise<void>) {}

  put(one: T): Promise<void> {
    if (this.waiting) {
      this.waiting.one = one
      return this.waiting.landed
    }
    if (!this.flying) return this.fly(one)

    const waiting = { one, landed: Promise.resolve() }
    waiting.landed = this.flying
      .catch(() => undefined)
      .then(() => {
        this.waiting = null
        return this.fly(waiting.one)
      })
    this.waiting = waiting
    return waiting.landed
  }

  get idle(): boolean {
    return this.flying === null && this.waiting === null
  }

  private fly(one: T): Promise<void> {
    const going = this.send(one)
    this.flying = going
    void going
      .catch(() => undefined)
      .finally(() => {
        if (this.flying === going) this.flying = null
      })
    return going
  }
}
