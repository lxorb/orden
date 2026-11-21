interface Made {
  global: number
  fields: [number, number, number][]
  rows: number[][]
}
export function fitBytes(messages: readonly Made[]): Uint8Array<ArrayBuffer> {
  const body: number[] = []
  const put = (value: number, width: number) => {
    for (let index = 0; index < width; index += 1) body.push((value >>> (8 * index)) & 0xff)
  }
  for (const [local, message] of messages.entries()) {
    body.push(0x40 | local, 0, 0)
    put(message.global, 2)
    body.push(message.fields.length)
    for (const [number, size, base] of message.fields) body.push(number, size, base)
    for (const row of message.rows) {
      body.push(local)
      for (const [index, [, size]] of message.fields.entries()) put(row[index] ?? 0, size)
    }
  }
  const size = [0, 8, 16, 24].map((shift) => (body.length >>> shift) & 0xff)
  const tag = [0x2e, 0x46, 0x49, 0x54]
  return new Uint8Array([14, 0x20, 0x00, 0x08, ...size, ...tag, 0, 0, ...body, 0, 0])
}
export const fitSeconds = (at: number): number => Math.round((at - 631_065_600_000) / 1000)
