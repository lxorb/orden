export interface HoldCheck {
  modified?: number
  budget?: { left: number }
}

export function spend(how: HoldCheck, size: number): boolean {
  if (!how.budget) return true
  how.budget.left -= size
  return how.budget.left >= 0
}
