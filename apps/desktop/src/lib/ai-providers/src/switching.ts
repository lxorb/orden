import type { CommandExtension } from '@orden/contracts'

interface AccountRow {
  id: string
  label: string
  active: boolean
}

let listing: (() => AccountRow[]) | null = null
let choosing: ((id: string) => void) | null = null

export function accountsAre(rows: () => AccountRow[], choose: (id: string) => void): void {
  listing = rows
  choosing = choose
}

export function accountRows(): CommandExtension[] {
  return (listing?.() ?? []).map((one) => ({
    id: `ai-account:${one.id}`,
    label: `AI account: ${one.label}`,
    checked: one.active,
    run: () => choosing?.(one.id),
  }))
}
