export interface FitMessage {
  global: number
  fields: Map<number, number | string | null>
}
interface Field {
  number: number
  size: number
  base: number
}
interface Definition {
  global: number
  little: boolean
  fields: Field[]
  extra: number
}
const FIT_EPOCH = 631_065_600_000
export const fitTime = (seconds: number): number => FIT_EPOCH + seconds * 1000
const INVALID: Record<number, number> = {
  0x00: 0xff,
  0x01: 0x7f,
  0x02: 0xff,
  0x83: 0x7fff,
  0x84: 0xffff,
  0x85: 0x7fffffff,
  0x86: 0xffffffff,
  0x0a: 0,
  0x8b: 0,
  0x8c: 0,
  0x0d: 0xff,
}
const WIDTH: Record<number, number> = {
  0x00: 1,
  0x01: 1,
  0x02: 1,
  0x0a: 1,
  0x0d: 1,
  0x83: 2,
  0x84: 2,
  0x8b: 2,
  0x85: 4,
  0x86: 4,
  0x8c: 4,
  0x88: 4,
  0x89: 8,
}
function valueOf(view: DataView, at: number, field: Field, little: boolean): number | string | null {
  const base = field.base
  if (base === 0x07) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + at, field.size)
    const end = bytes.indexOf(0)
    return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end)) || null
  }
  const width = WIDTH[base]
  if (width === undefined || field.size < width) return null
  let value: number
  if (width === 1) value = base === 0x01 ? view.getInt8(at) : view.getUint8(at)
  else if (width === 2) value = base === 0x83 ? view.getInt16(at, little) : view.getUint16(at, little)
  else if (base === 0x88) value = view.getFloat32(at, little)
  else if (base === 0x89) value = view.getFloat64(at, little)
  else value = base === 0x85 ? view.getInt32(at, little) : view.getUint32(at, little)
  if (base === 0x88 || base === 0x89) return Number.isFinite(value) ? value : null
  return value === INVALID[base] ? null : value
}
export function readFit(bytes: Uint8Array): FitMessage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12) throw new Error('not a FIT file')
  const head = bytes[0] ?? 0
  const tag = String.fromCharCode(...bytes.subarray(8, 12))
  if (tag !== '.FIT' || head < 12) throw new Error('not a FIT file')
  const end = Math.min(bytes.length, head + view.getUint32(4, true))
  const definitions = new Map<number, Definition>()
  const out: FitMessage[] = []
  let at = head
  let last = 0
  while (at < end) {
    const header = bytes[at] ?? 0
    at += 1
    if (header & 0x80) {
      const local = (header >> 5) & 0x03
      const offset = header & 0x1f
      const definition = definitions.get(local)
      if (!definition) throw new Error('a FIT record has no definition')
      const fields = new Map<number, number | string | null>()
      for (const field of definition.fields) {
        fields.set(field.number, valueOf(view, at, field, definition.little))
        at += field.size
      }
      at += definition.extra
      const stamped = (last & ~0x1f) + offset + (offset < (last & 0x1f) ? 0x20 : 0)
      last = stamped
      fields.set(253, stamped)
      out.push({ global: definition.global, fields })
      continue
    }
    const local = header & 0x0f
    if (header & 0x40) {
      const little = bytes[at + 1] === 0
      const global = little ? view.getUint16(at + 2, true) : view.getUint16(at + 2, false)
      const count = bytes[at + 4] ?? 0
      at += 5
      const fields: Field[] = []
      for (let index = 0; index < count; index += 1) {
        fields.push({ number: bytes[at] ?? 0, size: bytes[at + 1] ?? 0, base: bytes[at + 2] ?? 0 })
        at += 3
      }
      let extra = 0
      if (header & 0x20) {
        const developer = bytes[at] ?? 0
        at += 1
        for (let index = 0; index < developer; index += 1) {
          extra += bytes[at + 1] ?? 0
          at += 3
        }
      }
      definitions.set(local, { global, little, fields, extra })
      continue
    }
    const definition = definitions.get(local)
    if (!definition) throw new Error('a FIT record has no definition')
    const fields = new Map<number, number | string | null>()
    for (const field of definition.fields) {
      fields.set(field.number, valueOf(view, at, field, definition.little))
      at += field.size
    }
    at += definition.extra
    const stamp = fields.get(253)
    if (typeof stamp === 'number') last = stamp
    out.push({ global: definition.global, fields })
  }
  return out
}
