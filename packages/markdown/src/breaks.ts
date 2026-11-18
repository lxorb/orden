let hard = false

export function setHardBreaks(on: boolean) {
  hard = on
}

export const hardBreaks = (): boolean => hard
