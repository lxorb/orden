import { keep, storedText, isNative } from '../platform/src/api'

const ASKED = 'orden:kept-for-good-asked'

function storage(): StorageManager | null {
  if (isNative || typeof navigator === 'undefined') return null
  const manager = navigator.storage as StorageManager | undefined
  return typeof manager?.persist === 'function' && typeof manager.persisted === 'function'
    ? manager
    : null
}

class KeptForGood {
  held = $state<boolean | null>(null)
  private asking: Promise<void> | null = null

  get able(): boolean {
    return storage() !== null
  }

  look(): void {
    const manager = storage()
    if (!manager) return
    manager.persisted().then(
      (held) => (this.held = held),
      () => undefined,
    )
  }

  ask(): Promise<void> {
    if (!this.able || this.held === true || storedText(ASKED) !== null) return Promise.resolve()
    keep(ASKED, String(Date.now()))
    return this.again()
  }

  again(): Promise<void> {
    const manager = storage()
    if (!manager || this.held === true) return Promise.resolve()
    this.asking ??= manager
      .persist()
      .then(
        (held) => {
          this.held = held
        },
        () => undefined,
      )
      .finally(() => (this.asking = null))
    return this.asking
  }
}

export const keptForGood = new KeptForGood()
