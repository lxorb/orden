declare const __TESTING__: boolean | undefined

const UNDER_TEST = 200

export function rounds(real: number): number {
  return typeof __TESTING__ !== 'undefined' && __TESTING__ ? UNDER_TEST : real
}
