export const MOST_BOUND = 100

export const AT_A_TIME = 80

export function chunks<T>(all: readonly T[], size = AT_A_TIME): T[][] {
  const pieces: T[][] = []
  for (let at = 0; at < all.length; at += size) pieces.push(all.slice(at, at + size))
  return pieces
}

export async function askInChunks<T>(
  ids: readonly string[],
  ask: (chunk: string[]) => Promise<T[]>,
  size = AT_A_TIME,
): Promise<T[]> {
  const found: T[] = []
  for (const chunk of chunks(ids, size)) found.push(...(await ask(chunk)))
  return found
}

export function places(many: number): string {
  return Array.from({ length: many }, () => '?').join(', ')
}
