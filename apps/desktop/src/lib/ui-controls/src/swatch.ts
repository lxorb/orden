export interface SwatchOption {
  value: string
  label: string
  colour: string
}

export interface PairField {
  get(): readonly [string, string]
  own(): boolean
  preview(first: string, second: string): void
  set(first: string, second: string): void
}
