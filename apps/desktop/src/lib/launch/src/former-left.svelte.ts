import { invoke, isString, keep, storedText } from '../../platform/src/api'

const TOLD_KEY = 'orden:former-left-told'
function listed(former: unknown): string[] {
  const left = (former as { left?: unknown } | null | undefined)?.left
  return Array.isArray(left) ? left.filter(isString) : []
}
class FormerLeft {
  left = $state<string[]>(listed((globalThis as { __ORDEN_FORMER__?: unknown }).__ORDEN_FORMER__))
  private told = $state(storedText(TOLD_KEY))
  get showing(): boolean {
    return this.left.length > 0 && this.told !== this.left.join('\n')
  }
  dismiss() {
    this.told = this.left.join('\n')
    keep(TOLD_KEY, this.told)
  }
  async look() {
    const former = await invoke<unknown>('former_homes').catch(() => null)
    if (former !== null) this.left = listed(former)
  }
}
export const formerLeft = new FormerLeft()
