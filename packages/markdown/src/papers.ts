export const PAPERS = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
  long: { width: 794, height: 1123 },
} as const

export type Paper = keyof typeof PAPERS

export const PAPER_NAMES = Object.keys(PAPERS) as Paper[]

export function isPaper(value: unknown): value is Paper {
  return PAPER_NAMES.some((one) => one === value)
}

const NEAR = 2

export function paperSized(width: number, height: number): Paper {
  const near = (one: number, other: number) => Math.abs(one - other) <= NEAR

  if (near(width, PAPERS.letter.width) && near(height, PAPERS.letter.height)) return 'letter'

  return 'a4'
}

export function endless(paper: Paper): boolean {
  return paper === 'long'
}
