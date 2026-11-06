export interface Cost {
  n: number
  r: number
  p: number
}

async function pbkdf2(
  password: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 },
    key,
    bytes * 8,
  )
  return new Uint8Array(bits)
}

function salsa8(w: Uint32Array) {
  let x0 = w[0] ?? 0,
    x1 = w[1] ?? 0,
    x2 = w[2] ?? 0,
    x3 = w[3] ?? 0,
    x4 = w[4] ?? 0,
    x5 = w[5] ?? 0,
    x6 = w[6] ?? 0,
    x7 = w[7] ?? 0,
    x8 = w[8] ?? 0,
    x9 = w[9] ?? 0,
    x10 = w[10] ?? 0,
    x11 = w[11] ?? 0,
    x12 = w[12] ?? 0,
    x13 = w[13] ?? 0,
    x14 = w[14] ?? 0,
    x15 = w[15] ?? 0
  let t: number
  for (let round = 0; round < 8; round += 2) {
    t = (x0 + x12) | 0
    x4 ^= (t << 7) | (t >>> 25)
    t = (x4 + x0) | 0
    x8 ^= (t << 9) | (t >>> 23)
    t = (x8 + x4) | 0
    x12 ^= (t << 13) | (t >>> 19)
    t = (x12 + x8) | 0
    x0 ^= (t << 18) | (t >>> 14)
    t = (x5 + x1) | 0
    x9 ^= (t << 7) | (t >>> 25)
    t = (x9 + x5) | 0
    x13 ^= (t << 9) | (t >>> 23)
    t = (x13 + x9) | 0
    x1 ^= (t << 13) | (t >>> 19)
    t = (x1 + x13) | 0
    x5 ^= (t << 18) | (t >>> 14)
    t = (x10 + x6) | 0
    x14 ^= (t << 7) | (t >>> 25)
    t = (x14 + x10) | 0
    x2 ^= (t << 9) | (t >>> 23)
    t = (x2 + x14) | 0
    x6 ^= (t << 13) | (t >>> 19)
    t = (x6 + x2) | 0
    x10 ^= (t << 18) | (t >>> 14)
    t = (x15 + x11) | 0
    x3 ^= (t << 7) | (t >>> 25)
    t = (x3 + x15) | 0
    x7 ^= (t << 9) | (t >>> 23)
    t = (x7 + x3) | 0
    x11 ^= (t << 13) | (t >>> 19)
    t = (x11 + x7) | 0
    x15 ^= (t << 18) | (t >>> 14)
    t = (x0 + x3) | 0
    x1 ^= (t << 7) | (t >>> 25)
    t = (x1 + x0) | 0
    x2 ^= (t << 9) | (t >>> 23)
    t = (x2 + x1) | 0
    x3 ^= (t << 13) | (t >>> 19)
    t = (x3 + x2) | 0
    x0 ^= (t << 18) | (t >>> 14)
    t = (x5 + x4) | 0
    x6 ^= (t << 7) | (t >>> 25)
    t = (x6 + x5) | 0
    x7 ^= (t << 9) | (t >>> 23)
    t = (x7 + x6) | 0
    x4 ^= (t << 13) | (t >>> 19)
    t = (x4 + x7) | 0
    x5 ^= (t << 18) | (t >>> 14)
    t = (x10 + x9) | 0
    x11 ^= (t << 7) | (t >>> 25)
    t = (x11 + x10) | 0
    x8 ^= (t << 9) | (t >>> 23)
    t = (x8 + x11) | 0
    x9 ^= (t << 13) | (t >>> 19)
    t = (x9 + x8) | 0
    x10 ^= (t << 18) | (t >>> 14)
    t = (x15 + x14) | 0
    x12 ^= (t << 7) | (t >>> 25)
    t = (x12 + x15) | 0
    x13 ^= (t << 9) | (t >>> 23)
    t = (x13 + x12) | 0
    x14 ^= (t << 13) | (t >>> 19)
    t = (x14 + x13) | 0
    x15 ^= (t << 18) | (t >>> 14)
  }
  w[0] = ((w[0] ?? 0) + x0) | 0
  w[1] = ((w[1] ?? 0) + x1) | 0
  w[2] = ((w[2] ?? 0) + x2) | 0
  w[3] = ((w[3] ?? 0) + x3) | 0
  w[4] = ((w[4] ?? 0) + x4) | 0
  w[5] = ((w[5] ?? 0) + x5) | 0
  w[6] = ((w[6] ?? 0) + x6) | 0
  w[7] = ((w[7] ?? 0) + x7) | 0
  w[8] = ((w[8] ?? 0) + x8) | 0
  w[9] = ((w[9] ?? 0) + x9) | 0
  w[10] = ((w[10] ?? 0) + x10) | 0
  w[11] = ((w[11] ?? 0) + x11) | 0
  w[12] = ((w[12] ?? 0) + x12) | 0
  w[13] = ((w[13] ?? 0) + x13) | 0
  w[14] = ((w[14] ?? 0) + x14) | 0
  w[15] = ((w[15] ?? 0) + x15) | 0
}

function blockMix(b: Uint32Array, y: Uint32Array, r: number, x: Uint32Array) {
  const words = 32 * r
  x.set(b.subarray(words - 16, words))
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) x[k] = (x[k] ?? 0) ^ (b[i * 16 + k] ?? 0)
    salsa8(x)
    y.set(x, (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 16)
  }
}

function roMix(b: Uint32Array, { n, r }: Cost) {
  const words = 32 * r
  const v = new Uint32Array(words * n)
  const x = new Uint32Array(b)
  const y = new Uint32Array(words)
  const scratch = new Uint32Array(16)
  for (let i = 0; i < n; i++) {
    v.set(x, i * words)
    blockMix(x, y, r, scratch)
    x.set(y)
  }
  for (let i = 0; i < n; i++) {
    const j = (x[words - 16] ?? 0) & (n - 1)
    for (let k = 0; k < words; k++) x[k] = (x[k] ?? 0) ^ (v[j * words + k] ?? 0)
    blockMix(x, y, r, scratch)
    x.set(y)
  }
  b.set(x)
}

function littleEndian(bytes: Uint8Array<ArrayBuffer>): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Uint32Array(bytes.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true)
  return out
}

function bytesOf(words: Uint32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(words.length * 4)
  const view = new DataView(out.buffer)
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i] ?? 0, true)
  return out
}

export async function scrypt(
  password: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  cost: Cost,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const { n, r, p } = cost
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('scrypt: N must be a power of two')
  const words = 32 * r
  const b = littleEndian(await pbkdf2(password, salt, p * 128 * r))
  for (let i = 0; i < p; i++) roMix(b.subarray(i * words, (i + 1) * words), cost)
  return pbkdf2(password, bytesOf(b), length)
}
