const ROTATES = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
]

const SINES = Uint32Array.from({ length: 64 }, (_one, step) =>
  Math.floor(Math.abs(Math.sin(step + 1)) * 2 ** 32),
)

function rotated(value: number, by: number): number {
  return ((value << by) | (value >>> (32 - by))) >>> 0
}

export function md5(bytes: Uint8Array): string {
  const padded = withPadding(bytes)
  const words = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let block = 0; block < padded.length; block += 64) {
    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let step = 0; step < 64; step += 1) {
      const round = step >> 4
      let mixed: number
      let at: number

      switch (round) {
        case 0:
          mixed = (b & c) | (~b & d)
          at = step
          break
        case 1:
          mixed = (d & b) | (~d & c)
          at = (5 * step + 1) % 16
          break
        case 2:
          mixed = b ^ c ^ d
          at = (3 * step + 5) % 16
          break
        default:
          mixed = c ^ (b | ~d)
          at = (7 * step) % 16
      }

      const sum = (a + mixed + (SINES[step] ?? 0) + words.getUint32(block + at * 4, true)) >>> 0
      a = d
      d = c
      c = b
      b = (b + rotated(sum, ROTATES[round]?.[step % 4] ?? 0)) >>> 0
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  return [a0, b0, c0, d0].map(littleEndianHex).join('')
}

function withPadding(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const total = (((length + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(total)
  padded.set(bytes)
  padded[length] = 0x80

  const bits = length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(total - 8, bits >>> 0, true)
  view.setUint32(total - 4, Math.floor(bits / 2 ** 32), true)

  return padded
}

function littleEndianHex(word: number): string {
  let out = ''
  for (let byte = 0; byte < 4; byte += 1) {
    out += ((word >>> (byte * 8)) & 0xff).toString(16).padStart(2, '0')
  }
  return out
}
