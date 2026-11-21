export const counted = (count: number, one: string, many: string): string =>
  count === 1 ? `1 ${one}` : `${String(count)} ${many}`
