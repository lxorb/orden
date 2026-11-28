export interface Screen {
  readonly tab: string
  readonly at: number
}
export const MOST_SCREENS = 50
const same = (one: Screen | null, other: Screen | null): boolean =>
  one !== null && other !== null && one.tab === other.tab && one.at === other.at
export class Screens {
  depth = $state(0)
  private behind: Screen[] = []
  private now: Screen | null = null
  private returning: Screen | null = null
  private set(behind: Screen[], front = true) {
    const apart = behind.filter((one, at) => !same(one, behind[at - 1] ?? null))
    while (front && same(apart.at(-1) ?? null, this.now)) apart.pop()
    this.behind = apart.slice(-MOST_SCREENS)
    this.depth = this.behind.length
  }
  seen(shown: Screen | null): void {
    if (same(shown, this.now) || (shown === null && this.now === null)) return
    const back = this.returning
    this.returning = null
    const arrived = back !== null && shown !== null && back.tab === shown.tab && (back.at === shown.at || back.at < 0)
    const behind = arrived || !this.now ? this.behind : [...this.behind, this.now]
    this.now = shown
    this.set(behind)
  }
  keep(open: readonly string[]): void {
    const kept = this.behind.filter((one) => open.includes(one.tab))
    if (kept.length !== this.behind.length) this.set(kept)
  }
  back(): Screen | null {
    const to = this.behind.at(-1) ?? null
    if (!to) return null
    this.set(this.behind.slice(0, -1), false)
    this.returning = to.tab === this.now?.tab ? to : { tab: to.tab, at: -1 }
    return to
  }
}
