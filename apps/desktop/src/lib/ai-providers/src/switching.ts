export interface AccountRow {
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

export function switchableAccounts(): AccountRow[] {
  return listing?.() ?? []
}

export function switchAccount(id: string): void {
  choosing?.(id)
}
