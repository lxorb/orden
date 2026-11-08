import { type Look, lookIn } from '@orden/sync-core/look'

export interface LookWorld {
  token(): string | null
  look(): Look
  wear(look: Look): Promise<void>
  read(token: string): Promise<{ look?: unknown }>
  save(token: string, look: Look): Promise<unknown>
}

export class LookSync {
  private session = 0
  private sent = 0
  private saving = 0
  private owed = false

  constructor(private readonly world: LookWorld) {}

  picked(): void {
    this.sent++
    const token = this.world.token()
    if (token) void this.push(token)
  }

  async adopt(token: string): Promise<void> {
    const session = this.session
    if (this.owed) await this.push(token)
    if (this.session !== session || this.owed) return

    const asked = this.sent
    let remote: { look?: unknown }
    try {
      remote = await this.world.read(token)
    } catch {
      return
    }
    if (this.session !== session || this.sent !== asked || this.saving > 0) return

    const theirs = lookIn(remote.look)
    if (theirs) await this.world.wear(theirs)
    else await this.push(token)
  }

  forget(): void {
    this.session++
    this.owed = false
    this.saving = 0
  }

  private async push(token: string): Promise<void> {
    const look = lookIn(this.world.look())
    if (!look) return

    const session = this.session
    this.owed = false
    this.saving++
    try {
      await this.world.save(token, look)
    } catch {
      if (this.session === session) this.owed = true
    } finally {
      if (this.session === session) this.saving--
    }
  }
}
