import { internal, invoke, isNative } from '../tauri'
import { startup } from '../startup.svelte'
import { mark } from '../trace'
import { isWarmth, type PapersHeld, said, type Warmth } from './warmth'

class Warm {
  private held = $state<Warmth | null>(null)
  private root: string | null = null
  private papers = $state<PapersHeld | null>(null)

  readonly said = $derived(said(this.held, this.papers))

  holdingPapers(held: PapersHeld) {
    this.papers = held
  }

  async forSpace(root: string): Promise<void> {
    this.root = root
    this.held = null

    await startup.turn('search')
    if (this.root !== root) return

    if (!isNative) {
      const { warmSpace, whenWarmer } = await import('../web/search-client')
      whenWarmer((warmth) => {
        this.held = warmth
      })
      warmSpace(root)
      return
    }

    mark('warm_search asked')
    const kept = internal.routed
      ? await import('../internal/search')
          .then(({ warmInternal }) => warmInternal(root))
          .catch(() => null)
      : null
    const found = kept ?? (await invoke<unknown>('warm_search', { root }).catch(() => null))
    mark('warm_search answered')
    if (this.root === root && isWarmth(found)) this.held = found
  }
}

export const warm = new Warm()
