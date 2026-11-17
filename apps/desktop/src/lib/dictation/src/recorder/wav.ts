export const RATE = 16_000

const HEADER = 44

export function mono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first

  const out = new Float32Array(first.length)
  for (let at = 0; at < out.length; at++) {
    let sum = 0
    for (const channel of channels) sum += channel[at] ?? 0
    out[at] = sum / channels.length
  }

  return out
}

export function resampled(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || from <= 0 || samples.length === 0) return samples

  const count = Math.max(1, Math.round((samples.length * to) / from))
  const out = new Float32Array(count)
  const step = (samples.length - 1) / Math.max(1, count - 1)

  for (let at = 0; at < count; at++) {
    const where = at * step
    const below = Math.floor(where)
    const above = Math.min(below + 1, samples.length - 1)
    const part = where - below
    out[at] = (samples[below] ?? 0) * (1 - part) + (samples[above] ?? 0) * part
  }

  return out
}

function sixteenBit(sample: number): number {
  const held = Math.max(-1, Math.min(1, sample))
  return Math.round(held * (held < 0 ? 0x8000 : 0x7fff))
}

export function wavOf(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let one = 0; one < text.length; one++) view.setUint8(at + one, text.charCodeAt(one))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let at = 0; at < samples.length; at++) {
    view.setInt16(HEADER + at * 2, sixteenBit(samples[at] ?? 0), true)
  }

  return bytes
}

function samplesIn(seconds: number, rate: number): number {
  return Math.max(1, Math.round(seconds * rate))
}

export function pieces(samples: Float32Array, rate: number, seconds: number): Float32Array[] {
  const most = samplesIn(seconds, rate)
  if (samples.length <= most) return samples.length ? [samples] : []

  const out: Float32Array[] = []
  for (let at = 0; at < samples.length; at += most) {
    out.push(samples.subarray(at, Math.min(at + most, samples.length)))
  }

  return out
}
