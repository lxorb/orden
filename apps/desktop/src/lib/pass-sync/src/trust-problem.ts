export type TrustReason = 'unasked' | 'unproven' | 'older' | 'swapped' | 'replayed'

export interface TrustProblem {
  vault: string
  item: string | null
  reason: TrustReason
}

export function trustWords(problem: TrustProblem): string {
  return {
    unasked: 'The account offered a vault you never made or accepted. Pass left it out.',
    unproven: 'A vault got a key its owner did not sign. Pass kept the one it had.',
    older: 'The account sent an older key for a vault. Pass kept the newer one.',
    swapped: 'The account sent another key for a vault. Pass kept the one it had.',
    replayed: 'The account sent an older copy of an item. Pass kept the newer one.',
  }[problem.reason]
}
