const MAGIC = [0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00]

const MOST_BYTES = 256 * 1024 * 1024

const SHORTEST_MATCH = 4

export function unmozLz4(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || MAGIC.some((byte, at) => bytes[at] !== byte)) {
    throw new Error('not a mozLz4 file')
  }

  const size = new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0, true)
  if (size > MOST_BYTES) throw new Error('a mozLz4 file larger than any session')

  return lz4Block(bytes.subarray(12), size)
}

export function lz4Block(input: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let from = 0
  let to = 0

  const longer = (length: number): number => {
    let more = 255
    while (more === 255) {
      if (from >= input.length) throw new Error('a mozLz4 block cut short')
      more = input[from++] ?? 0
      length += more
    }
    return length
  }

  while (from < input.length) {
    const token = input[from++] ?? 0

    let literals = token >> 4
    if (literals === 15) literals = longer(literals)
    if (from + literals > input.length || to + literals > size) {
      throw new Error('a mozLz4 block cut short')
    }
    out.set(input.subarray(from, from + literals), to)
    from += literals
    to += literals

    if (from >= input.length) break

    if (from + 2 > input.length) throw new Error('a mozLz4 block cut short')
    const back = (input[from] ?? 0) | ((input[from + 1] ?? 0) << 8)
    from += 2
    if (back === 0 || back > to) throw new Error('a mozLz4 block pointing before itself')

    let length = token & 15
    if (length === 15) length = longer(length)
    length += SHORTEST_MATCH
    if (to + length > size) throw new Error('a mozLz4 block longer than it says')

    for (let at = 0; at < length; at++, to++) out[to] = out[to - back] ?? 0
  }

  if (to !== size) throw new Error('a mozLz4 block shorter than it says')
  return out
}
