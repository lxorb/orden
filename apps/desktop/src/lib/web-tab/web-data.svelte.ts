export const HISTORY = 'nib:web-visits'

export function ownStore(own: string | null | undefined): string | null {
  return own ? `note_${own}` : null
}

export function freshOwn(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; read on a press
const copying = new Map<string, number>()

export function isCopying(own: string): boolean {
  return (copying.get(own) ?? 0) > 0
}

export async function copyingOut<T>(own: string, copy: () => Promise<T>): Promise<T> {
  copying.set(own, (copying.get(own) ?? 0) + 1)
  try {
    return await copy()
  } finally {
    const left = (copying.get(own) ?? 1) - 1
    if (left > 0) copying.set(own, left)
    else copying.delete(own)
  }
}

class WebData {
  private merging: Promise<void> | null = null

  async store(own: string | null | undefined): Promise<string | null> {
    await this.merged()
    return ownStore(own)
  }

  history(): string {
    return HISTORY
  }

  merged(): Promise<void> {
    this.merging ??= import('./merged').then((one) => one.mergeOld())
    return this.merging
  }
}

export const webData = new WebData()
