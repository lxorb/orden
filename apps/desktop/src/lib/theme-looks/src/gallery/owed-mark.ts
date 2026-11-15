export interface OwedAccount {
  readonly token: string | null
  readonly user: { id: string } | null
  forgetWithSession(clear: () => void): void
}

export interface OwedStore {
  read(key: string): unknown
  write(key: string, value: unknown): void
  drop(key: string): void
}

export class OwedMark {
  private latest = 0

  constructor(
    private readonly key: string,
    private readonly account: OwedAccount,
    private readonly store: OwedStore,
  ) {
    account.forgetWithSession(() => store.drop(key))
  }

  private get owner(): string | null | undefined {
    const kept = this.store.read(this.key)
    if (typeof kept !== 'object' || kept === null || !('who' in kept)) return undefined
    return typeof kept.who === 'string' ? kept.who : null
  }

  get standing(): boolean {
    const owner = this.owner
    if (owner === undefined) return false
    const who = this.account.user?.id ?? null
    return owner === null || who === null || owner === who
  }

  mark(): number {
    if (!this.account.token) return 0
    const who = this.account.user?.id ?? (this.standing ? this.owner : null) ?? null
    this.store.write(this.key, { who })
    return ++this.latest
  }

  heard(ticket: number, who = this.account.user?.id ?? null): void {
    if (ticket === 0 || ticket !== this.latest) return
    const owner = this.owner
    if (owner === null || owner === who) this.store.drop(this.key)
  }
}
