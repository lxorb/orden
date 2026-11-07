const SEGMENT = 0x18538067
const TRACKS = 0x1654ae6b
const TRACK = 0xae
const CODEC = 0x86
const PRIVATE = 0x63a2
const CLUSTER = 0x1f43b675
const SIMPLE = 0xa3
const GROUP = 0xa0
const BLOCK = 0xa1
const CHANNELS = 0x9f
const AUDIO = 0xe1

const DESCEND = new Set([SEGMENT, TRACKS, TRACK, CLUSTER, GROUP, AUDIO])

interface Read {
  value: number
  length: number
  unknown: boolean
}

function vint(bytes: Uint8Array, at: number, keep: boolean): Read | null {
  const first = bytes[at]
  if (first === undefined || first === 0) return null
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (at + length > bytes.length) return null
  let value = keep ? first : first & (0xff >> length)
  let ones = value === 0xff >> length
  for (let index = 1; index < length; index++) {
    const byte = bytes[at + index] ?? 0
    value = value * 256 + byte
    if (byte !== 0xff) ones = false
  }
  return { value, length, unknown: !keep && ones }
}

interface Found {
  codec: string
  head: Uint8Array | null
  channels: number
  packets: Uint8Array[]
}

function walk(bytes: Uint8Array, from: number, to: number, found: Found): void {
  let at = from
  while (at < to) {
    const id = vint(bytes, at, true)
    if (!id) return
    const size = vint(bytes, at + id.length, false)
    if (!size) return
    const start = at + id.length + size.length
    const end = size.unknown ? to : Math.min(to, start + size.value)
    if (DESCEND.has(id.value)) {
      walk(bytes, start, end, found)
    } else if (id.value === CODEC) {
      found.codec = new TextDecoder().decode(bytes.subarray(start, end))
    } else if (id.value === PRIVATE) {
      found.head = bytes.slice(start, end)
    } else if (id.value === CHANNELS) {
      found.channels = bytes[start] ?? 1
    } else if (id.value === SIMPLE || id.value === BLOCK) {
      const track = vint(bytes, start, false)
      if (track) {
        const flags = bytes[start + track.length + 2] ?? 0
        if ((flags & 0x06) === 0) found.packets.push(bytes.slice(start + track.length + 3, end))
      }
    }
    if (size.unknown) return
    at = end
  }
}

export function samplesOf(packet: Uint8Array): number {
  const toc = packet[0]
  if (toc === undefined) return 0
  const config = toc >> 3
  const tenths =
    config < 12
      ? [100, 200, 400, 600][config % 4]
      : config < 16
        ? [100, 200][config % 2]
        : [25, 50, 100, 200][config % 4]
  const code = toc & 3
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2
  return (frames * (tenths ?? 200) * 48) / 10
}

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit++)
      value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1
    table[index] = value >>> 0
  }
  return table
})()

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) crc = ((crc << 8) ^ (TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0
  return crc
}

function page(packet: Uint8Array, kind: number, granule: number, sequence: number): Uint8Array {
  const lacing: number[] = []
  let left = packet.length
  while (left >= 255) {
    lacing.push(255)
    left -= 255
  }
  lacing.push(left)
  const out = new Uint8Array(27 + lacing.length + packet.length)
  const view = new DataView(out.buffer)
  out.set([0x4f, 0x67, 0x67, 0x53, 0, kind])
  view.setUint32(6, granule % 0x100000000, true)
  view.setUint32(10, Math.floor(granule / 0x100000000), true)
  view.setUint32(14, 0x6f72646e, true)
  view.setUint32(18, sequence, true)
  out[26] = lacing.length
  out.set(lacing, 27)
  out.set(packet, 27 + lacing.length)
  view.setUint32(22, oggCrc(out), true)
  return out
}

function opusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19)
  head.set(new TextEncoder().encode('OpusHead'))
  const view = new DataView(head.buffer)
  head[8] = 1
  head[9] = channels
  view.setUint16(10, 312, true)
  view.setUint32(12, 48000, true)
  return head
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('orden')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set(new TextEncoder().encode('OpusTags'))
  new DataView(tags.buffer).setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  return tags
}

export function oggOf(bytes: Uint8Array, type: string): Uint8Array | null {
  if (type.startsWith('audio/ogg')) return bytes
  if (!type.includes('webm')) return null
  const found: Found = { codec: '', head: null, channels: 1, packets: [] }
  walk(bytes, 0, bytes.length, found)
  if (found.codec !== 'A_OPUS' || !found.packets.length) return null
  const pages: Uint8Array[] = [
    page(found.head ?? opusHead(found.channels), 0x02, 0, 0),
    page(opusTags(), 0, 0, 1),
  ]
  let granule = 0
  found.packets.forEach((packet, index) => {
    granule += samplesOf(packet)
    const last = index === found.packets.length - 1
    pages.push(page(packet, last ? 0x04 : 0, granule, index + 2))
  })
  const out = new Uint8Array(pages.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of pages) {
    out.set(one, at)
    at += one.length
  }
  return out
}

const BARS = 100

export function waveOf(packed: Uint8Array | undefined): number[] | undefined {
  if (!packed?.length) return undefined
  const count = Math.floor((packed.length * 8) / 5)
  const out: number[] = []
  for (let index = 0; index < count; index++) {
    const bit = index * 5
    const byte = bit >> 3
    const pair = (packed[byte] ?? 0) | ((packed[byte + 1] ?? 0) << 8)
    out.push(Math.round((((pair >> (bit & 7)) & 31) * 255) / 31))
  }
  return out
}

export function packedOf(wave: readonly number[] | undefined): Uint8Array | undefined {
  if (!wave?.length) return undefined
  const bars = Array.from({ length: BARS }, (_, index) => {
    const value = wave[Math.floor((index * wave.length) / BARS)] ?? 0
    return Math.max(0, Math.min(31, Math.round((value * 31) / 255)))
  })
  const out = new Uint8Array(Math.ceil((BARS * 5) / 8))
  bars.forEach((value, index) => {
    const bit = index * 5
    const byte = bit >> 3
    const shifted = value << (bit & 7)
    out[byte] = (out[byte] ?? 0) | (shifted & 0xff)
    if (byte + 1 < out.length) out[byte + 1] = (out[byte + 1] ?? 0) | (shifted >> 8)
  })
  return out
}
