import { internal, invoke, isNative, mark } from '../../platform/src/api'
import { startup } from '../../launch/src/api'
import { warmInternal, warmSpace } from '../../web-backend/src/api'
import { isWarmth, type PapersHeld, said, type Warmth } from '@orden/scan/search/warmth'

class Warm {
  private held = $state<Warmth | null>(null)
  private root: string | null = null
  private papers = $state<PapersHeld | null>(null)
  private hearing: Promise<void> | null = null

  readonly said = $derived(said(this.held, this.papers))

  async forSpace(root: string): Promise<void> {
    this.root = root
    this.held = null

    await startup.turn('search')
    this.hearing ??= import('../../pdf/src/api')
      .then((pdf) => pdf.papers())
      .then((one) => one.hearPapers((held) => (this.papers = held)))
      .catch(() => {
        this.hearing = null
      })
    if (this.root !== root) return

    if (!isNative) {
      await warmSpace(root, (warmth) => {
        this.held = warmth
      })
      return
    }

    mark('warm_search asked')
    const kept = internal.routed ? await warmInternal(root).catch(() => null) : null
    const found = kept ?? (await invoke<unknown>('warm_search', { root }).catch(() => null))
    mark('warm_search answered')
    if (this.root === root && isWarmth(found)) this.held = found
  }
}

export const warm = new Warm()
