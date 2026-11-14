export const RATE = 16_000

export function room(seconds: number, loud = 0.002): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  let seed = 7
  for (let at = 0; at < out.length; at++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    out[at] = (seed / 2147483648 - 0.5) * 2 * loud
  }
  return out
}

export function voice(seconds: number): Float32Array {
  const out = room(seconds)
  for (let at = 0; at < out.length; at++) out[at] = (out[at] ?? 0) + 0.2 * Math.sin(at / 9)
  return out
}

export function joined(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    out.set(one, at)
    at += one.length
  }
  return out
}
